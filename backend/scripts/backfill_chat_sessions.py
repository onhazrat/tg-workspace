#!/usr/bin/env python3
"""Move chats out of `tg_summaries` and into `tg_chat_sessions`.

A chat used to be a `Summary` whose `text` began with the literal string
`"Chat: "`, with the transcript in `tg_summary_payloads.chat_messages`. Two
shapes exist in the data:

* **chat-only** — `text` starts with `"Chat: "`. Becomes a chat session; the
  summary rows are **deleted**, because they were never a summary.
* **summary + chat** — a real summary that someone chatted about. The summary is
  **kept**, `chat_messages` is cleared from its payload, and the transcript
  becomes a standalone chat session. There is no link back: chat mode
  `full_scope` never read the summary, so the only thing that ever tied them
  together was which summary happened to be selected at the time.

## Why this is a script and not part of the migration

It deletes user artifacts, and `scripts/prestart.sh` runs `alembic upgrade head`
unattended on every container start — so as a migration it would have no
operator in the loop and no way to see the counts first. It also is not
expressible in SQL: a summary+chat row's title comes from the first user message
*inside a JSON array*, collapsed and truncated by the same code the service uses.

Idempotent per row: the chat session id is derived deterministically, so a
re-run skips what it already moved. Runs in bounded batches rather than one
transaction — a session held open across a large migration pins the xmin horizon
and autovacuum reclaims nothing for its duration.

Usage:
    uv run python backend/scripts/backfill_chat_sessions.py --dry-run
    uv run python backend/scripts/backfill_chat_sessions.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_REPO_ROOT / ".env")

from sqlalchemy import and_, cast, func, text  # noqa: E402
from sqlalchemy.dialects.postgresql import JSONB  # noqa: E402
from sqlalchemy.sql.elements import ColumnElement  # noqa: E402
from sqlmodel import Session, col, select  # noqa: E402

from app.core.db import engine  # noqa: E402
from app.models_tg import (  # noqa: E402
    ChatSession,
    DiscoverReport,
    Summary,
    SummaryPayload,
)
from app.services.chat_sessions import (  # noqa: E402
    apply_chat_session_payload,
    derive_chat_title,
    refresh_chat_session_derived_columns,
)
from app.services.summaries import (  # noqa: E402
    apply_summary_payload,
    refresh_summary_derived_columns,
)

CHAT_PREFIX = "Chat: "


def _has_transcript() -> ColumnElement[bool]:
    """Rows whose `chat_messages` holds an actual conversation.

    **Not** `chat_messages IS NOT NULL`. SQLAlchemy's `JSON` type serialises
    Python `None` to a JSON `null` rather than an SQL NULL, so a payload row
    written for `promptText` alone still has a non-NULL `chat_messages` — and
    `IS NOT NULL` matches every summary that has a payload at all. Left
    unnoticed, that classifies every summary as "summary + chat" and extracts an
    empty chat session for each one.

    An empty array is excluded too: a chat with no turns is not a chat. That
    check compares against `'[]'::jsonb` rather than calling
    `jsonb_array_length`, because Postgres does not short-circuit `AND` — it
    evaluates the length on rows the type check already excluded, and errors
    with "cannot get array length of a scalar". Equality against a literal is
    defined for every json type.
    """
    as_jsonb = cast(col(SummaryPayload.chat_messages), JSONB)
    return and_(
        col(SummaryPayload.chat_messages).is_not(None),
        func.jsonb_typeof(as_jsonb) == "array",
        # A SQL literal, not `cast("[]", JSONB)`: that binds a Python string,
        # which psycopg serialises to the JSON *string* `"[]"` rather than the
        # empty array, so the comparison never matched.
        as_jsonb != text("'[]'::jsonb"),
    )


def _chat_session_id(summary_id: str, *, chat_only: bool) -> str:
    """Deterministic, so a re-run recognises what it already moved.

    A chat-only summary keeps its id — it *is* the artifact, just relabelled.
    A summary+chat row gets a derived id, because the summary keeps the original.
    """
    return summary_id if chat_only else f"{summary_id}:chat"


def _move_one(session: Session, summary: Summary, payload: SummaryPayload) -> str:
    messages = payload.chat_messages
    chat_only = summary.text.startswith(CHAT_PREFIX)
    chat_id = _chat_session_id(summary.id, chat_only=chat_only)

    # A chat-only row already carries the title after its prefix. Preferring it
    # over re-deriving keeps the label someone actually saw in their history,
    # even where the transcript's first turn would truncate differently.
    title = (
        summary.text[len(CHAT_PREFIX) :].strip()
        if chat_only
        else derive_chat_title(messages)
    )

    row = ChatSession(
        id=chat_id,
        user_id=summary.user_id,
        title=title,
        channels=summary.channels,
        start_date=summary.start_date,
        end_date=summary.end_date,
        language=summary.language,
        model=summary.model,
        # Pre-split chats recorded no mode. `full_scope` is the honest default:
        # `semantic` was opt-in per message and was never persisted anywhere.
        mode="full_scope",
        post_count=summary.post_count,
        timestamp=summary.timestamp,
        extra=dict(summary.extra or {}) if chat_only else {},
        message_count=0,
    )
    session.add(row)
    chat_payload = apply_chat_session_payload(
        session,
        chat_id,
        user_id=summary.user_id,
        updates={"messages": messages},
    )
    refresh_chat_session_derived_columns(row, chat_payload)

    if chat_only:
        session.delete(summary)
        session.delete(payload)
    else:
        remaining = apply_summary_payload(
            session,
            summary.id,
            user_id=summary.user_id,
            updates={},
            removals={"chat_messages"},
        )
        refresh_summary_derived_columns(summary, remaining)
        session.add(summary)

    return "chatOnly" if chat_only else "summaryPlusChat"


def backfill_chats(*, dry_run: bool, batch: int) -> dict[str, int]:
    """Move every chat, in bounded transactions.

    Pages by **keyset** on `Summary.id`, not by "rows that still match".
    Relying on rows dropping out of `_has_transcript()` after being written
    looks like it works and does not: a dry run rolls the writes back, so the
    next query returns the identical page and the loop stops after one — a
    `--dry-run` on any install with more than `batch` chats reported exactly
    `batch`. Since the entire reason this is a script is to show an operator the
    count *before* it deletes rows, that made the safety mechanism lie. A real
    run had the same flaw whenever `batch` rows were already moved.
    """
    counts = {"chatOnly": 0, "summaryPlusChat": 0, "alreadyMoved": 0}
    cursor: str | None = None

    while True:
        with Session(engine) as session:
            statement = (
                select(Summary, SummaryPayload)
                .join(SummaryPayload, col(SummaryPayload.summary_id) == col(Summary.id))
                .where(_has_transcript())
            )
            if cursor is not None:
                statement = statement.where(col(Summary.id) > cursor)
            rows = session.exec(statement.order_by(col(Summary.id)).limit(batch)).all()
            if not rows:
                return counts

            for summary, payload in rows:
                cursor = summary.id
                chat_only = summary.text.startswith(CHAT_PREFIX)
                chat_id = _chat_session_id(summary.id, chat_only=chat_only)
                if session.get(ChatSession, chat_id) is not None:
                    counts["alreadyMoved"] += 1
                    continue
                counts[_move_one(session, summary, payload)] += 1

            if dry_run:
                session.rollback()
                continue
            session.commit()


def backfill_candidate_counts(*, dry_run: bool) -> int:
    """`candidate_count` for reports written before the column existed.

    The migration's `UPDATE` already did this; the pass here catches rows
    written between the migration and the deploy, and makes a re-run safe.
    """
    fixed = 0
    with Session(engine) as session:
        for report in session.exec(select(DiscoverReport)).all():
            actual = len(report.candidates or [])
            if report.candidate_count != actual:
                report.candidate_count = actual
                session.add(report)
                fixed += 1
        if dry_run:
            session.rollback()
        else:
            session.commit()
    return fixed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would move without writing anything",
    )
    parser.add_argument(
        "--batch", type=int, default=200, help="rows per transaction (default 200)"
    )
    args = parser.parse_args()

    report = {
        "dryRun": args.dry_run,
        **backfill_chats(dry_run=args.dry_run, batch=args.batch),
        "candidateCountsFixed": backfill_candidate_counts(dry_run=args.dry_run),
    }
    sys.stdout.write(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
