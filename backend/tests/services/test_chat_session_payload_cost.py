"""Listing chat sessions must not open the table the transcript lives in.

The sibling of `test_summary_list_payload_cost`, and it arrives already knowing
the answer: these exact values sat in `Summary.extra` under `chatMessages` and
cost a measured 26 MB per 49-row page. Promoting chats to their own aggregate
must not walk that back.

## What is asserted, and why the third clause matters most

Following `frontend/src/api/client-split.conform.ts`: assert the *reason*, not
just the state.

1. the **list** does not touch the payload table,
2. the **detail** call does — proving the guard can see the table at all,
3. the **derived columns are what stand in for it**. Without (3) a guard that
   pinned only (1) and (2) would stay green while `message_count` and `title`
   went stale, and the list would quietly become useless: every row rendering
   "0 messages" with a blank title, from a query that is technically cheap.
4. the transcript is **not in `extra`** — the storage location itself.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event, func
from sqlmodel import Session, col, select

from app.core.db import engine
from app.models_tg import ChatSession, ChatSessionPayload
from app.services.chat_sessions import (
    HEAVY_CHAT_FIELDS,
    delete_chat_session,
    get_chat_session,
    list_chat_sessions,
    upsert_chat_session,
)
from tests.utils.tenancy import ANY_READER

PAYLOAD_TABLE = "tg_chat_session_payloads"


@contextmanager
def captured_sql() -> Iterator[list[str]]:
    """Every statement the engine executes inside the block.

    A third copy of this helper (`test_summary_list_payload_cost`,
    `test_log_list_payload_cost`). Deliberately not extracted: each guard is
    meant to be readable start to finish by someone who arrived because it went
    red, and a shared conftest helper is one more file to find.
    """
    statements: list[str] = []

    def before_cursor_execute(
        conn: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)


def _write(session: Session, chat_id: str, **body: object) -> None:
    upsert_chat_session(
        session,
        chat_id,
        {"channels": [], "timestamp": 1, **body},
        user_id=ANY_READER,
    )


def _payload_rows(session: Session, chat_id: str) -> int:
    return session.exec(
        select(func.count())
        .select_from(ChatSessionPayload)
        .where(col(ChatSessionPayload.chat_session_id) == chat_id)
    ).one()


def _turns(n: int, size: int = 1) -> list[dict[str, str]]:
    return [
        {"role": "user" if i % 2 == 0 else "model", "text": "x" * size}
        for i in range(n)
    ]


def test_listing_does_not_touch_the_payload_table() -> None:
    with Session(engine) as session:
        _write(session, "chat-cost-list", messages=_turns(6, 1000))

        with captured_sql() as statements:
            list_chat_sessions(session, user_id=ANY_READER)

    assert statements, "no SQL captured — the listener is not wired up"
    offenders = [s for s in statements if PAYLOAD_TABLE in s]
    assert not offenders, f"list_chat_sessions read the payload table: {offenders}"


def test_the_detail_call_does_touch_it_and_that_is_why_the_list_need_not() -> None:
    """Three clauses in one test, because they only mean anything together.

    The detail call returns the transcript and opens the payload table to do it;
    the list row carries no transcript but reports a count and a title that
    *agree with* what the detail call returned. That agreement is the whole
    justification for the list skipping the table — pin the first two alone and
    the derived columns can rot unnoticed.
    """
    with Session(engine) as session:
        _write(session, "chat-cost-detail", messages=_turns(4))

        with captured_sql() as statements:
            detail = get_chat_session(session, "chat-cost-detail", user_id=ANY_READER)

        listed = next(
            row
            for row in list_chat_sessions(session, user_id=ANY_READER)
            if row["id"] == "chat-cost-detail"
        )

    assert len(detail["messages"]) == 4
    assert any(PAYLOAD_TABLE in s for s in statements)

    assert "messages" not in listed
    assert listed["messageCount"] == len(detail["messages"])
    assert listed["title"] == detail["messages"][0]["text"]


def test_derived_columns_are_refreshed_on_every_write() -> None:
    """A second write with a shorter transcript must shrink the count.

    The failure this catches is a write path that sets the derived columns from
    the request body instead of from what was actually stored.
    """
    with Session(engine) as session:
        _write(session, "chat-cost-refresh", messages=_turns(6))
        _write(session, "chat-cost-refresh", messages=_turns(2))

        row = session.get(ChatSession, "chat-cost-refresh")
        assert row is not None
        assert row.message_count == 2


def test_the_transcript_is_not_stored_in_extra() -> None:
    """The storage location, not just the query shape.

    Moving `messages` back into `extra` would restore the original defect while
    leaving the "list does not read the payload table" assertion green.
    """
    with Session(engine) as session:
        _write(
            session,
            "chat-cost-extra",
            messages=_turns(2),
            isStarred=True,
        )

        row = session.get(ChatSession, "chat-cost-extra")
        assert row is not None
        assert set(row.extra or {}).isdisjoint(HEAVY_CHAT_FIELDS)
        assert (row.extra or {})["isStarred"] is True


def test_a_page_of_huge_transcripts_still_serialises_small() -> None:
    """Bytes, not seconds: wall clock would flake on a loaded machine."""
    with Session(engine) as session:
        for i in range(5):
            _write(session, f"chat-cost-big-{i}", messages=_turns(20, 50_000))

        page = list_chat_sessions(session, user_id=ANY_READER)

    assert len(json.dumps(page)) < 50_000


def test_deleting_takes_the_payload_with_it() -> None:
    """No FK to cascade from, so the aggregate has to do it explicitly."""
    with Session(engine) as session:
        _write(session, "chat-cost-delete", messages=_turns(2))
        delete_chat_session(session, "chat-cost-delete", user_id=ANY_READER)

        remaining = _payload_rows(session, "chat-cost-delete")

    assert remaining == 0


def test_a_chat_with_no_transcript_gets_no_payload_row() -> None:
    """The 'never accumulate empty rows' rule `apply_summary_payload` follows."""
    with Session(engine) as session:
        _write(session, "chat-cost-empty")

        remaining = _payload_rows(session, "chat-cost-empty")

    assert remaining == 0
