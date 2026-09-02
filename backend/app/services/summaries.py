"""Summary CRUD helpers for TG Summarizer data APIs.

A summary is stored as **two rows**: `Summary` (the base columns plus a small
open `extra` bag) and `SummaryPayload` (`citedPosts` / `promptText` /
`chatMessages`). That split is what makes listing cheap — see the
`SummaryPayload` docstring for the measurements behind it. This module owns
both tables and is the only place that knows they are two.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Text, cast, or_
from sqlalchemy import select as sa_select
from sqlmodel import Session, col, select

from app.core import acting_owner
from app.models_tg import Summary, SummaryPayload, utc_now
from app.services.serialization import to_snake
from app.services.tenancy import (
    assert_owner,
    assert_owner_on_write,
    scoped_select,
)

#: The 404 this family answers for a row that is not there. `assert_owner`
#: reuses it for a row that is there and belongs to someone else, so the two
#: are indistinguishable — a resource-specific detail beside a generic one is
#: the enumeration oracle the 404-not-403 rule exists to close.
SUMMARY_NOT_FOUND = "Summary not found"

DEFAULT_SUMMARY_PAGE_SIZE = 200
MAX_SUMMARY_PAGE_SIZE = 2000

#: Wire key -> `SummaryPayload` column for the corpus-sized fields. `to_snake`
#: of each camelCase key *is* its column name, so a body that sends either
#: spelling routes to the same place.
PAYLOAD_COLUMNS: dict[str, str] = {
    "citedPosts": "cited_posts",
    "promptText": "prompt_text",
    "chatMessages": "chat_messages",
}

# Fields that carry a whole corpus rather than metadata. Derived from
# PAYLOAD_COLUMNS rather than written out twice: adding a fourth heavy field
# means one entry above, a migration, and nothing else here.
HEAVY_SUMMARY_FIELDS = frozenset(PAYLOAD_COLUMNS)
_PAYLOAD_COLUMN_NAMES = frozenset(PAYLOAD_COLUMNS.values())

#: Computed from the payload on every write, never accepted from a request.
#: Clients round-trip list items back through `PUT`, so without this the
#: derived values would be stored into `extra` and then shadow the real ones.
DERIVED_SUMMARY_FIELDS = frozenset({"chat_message_count", "prompt_excerpt"})

# Matches truncatePreview's default in frontend/src/lib/commands/search-filters.ts.
SUMMARY_PROMPT_EXCERPT_CHARS = 80


def _summary_base(summary: Summary) -> dict[str, Any]:
    return {
        "id": summary.id,
        "text": summary.text,
        "channels": summary.channels,
        "startDate": summary.start_date,
        "endDate": summary.end_date,
        "language": summary.language,
        "model": summary.model,
        "postCount": summary.post_count,
        "timestamp": summary.timestamp,
    }


def summary_to_camel(
    summary: Summary, payload: SummaryPayload | None = None
) -> dict[str, Any]:
    """Full projection, reassembling the two rows into one flat object.

    A heavy field is emitted only when the payload row actually holds it, so
    the wire format is unchanged from when they lived in `extra`: a key that
    was absent stays absent rather than becoming an explicit `null`.
    """
    heavy = {}
    if payload is not None:
        for key, column in PAYLOAD_COLUMNS.items():
            value = getattr(payload, column)
            if value is not None:
                heavy[key] = value
    return {**_summary_base(summary), **(summary.extra or {}), **heavy}


def _derive_chat_message_count(chat_messages: Any) -> int:
    return len(chat_messages) if isinstance(chat_messages, list) else 0


def _derive_prompt_excerpt(prompt_text: Any) -> str | None:
    """The palette's preview, or `None` when there is no prompt to preview.

    `None` and `""` are different on the wire: a whitespace-only prompt keeps
    today's behaviour of emitting an empty `promptExcerpt`, while no prompt at
    all omits the key entirely.
    """
    if not isinstance(prompt_text, str) or not prompt_text:
        return None
    collapsed = " ".join(prompt_text.split())
    if len(collapsed) <= SUMMARY_PROMPT_EXCERPT_CHARS:
        return collapsed
    return collapsed[: SUMMARY_PROMPT_EXCERPT_CHARS - 1] + "…"


def summary_to_camel_light(summary: Summary) -> dict[str, Any]:
    """List-view projection — everything the base row holds, and nothing else.

    Reads `Summary` alone. The corpus-sized fields are in another table, and
    the two things the list surfaces actually showed of them
    (`chatMessageCount`, `promptExcerpt`) are columns here, maintained on
    write.

    The small `extra` flags (`isStarred`, `autoPublish`, `note`, …) all pass
    through: they are what the history and search lists render, and an
    allowlist would silently lose new ones.
    """
    light = dict(summary.extra or {})
    light["chatMessageCount"] = summary.chat_message_count
    if summary.prompt_excerpt is not None:
        light["promptExcerpt"] = summary.prompt_excerpt
    return {**_summary_base(summary), **light}


def _search_clause(term: str) -> Any:
    """Case-insensitive substring match, mirroring the client-side filter.

    Prompt bodies are reached through an `EXISTS` against the payload table
    rather than a join, so the list query stays a single-table select and only
    a search pays to open the heavy half. `citedPosts` is not searched — it
    never was, and now it is not even in the same column as the text that is.
    """
    like = f"%{term}%"
    prompt_match = (
        sa_select(1)
        .where(
            col(SummaryPayload.summary_id) == col(Summary.id),
            col(SummaryPayload.prompt_text).ilike(like),
        )
        .exists()
    )
    return or_(
        col(Summary.text).ilike(like),
        cast(col(Summary.channels), Text).ilike(like),
        col(Summary.model).ilike(like),
        prompt_match,
        col(Summary.extra).op("->>")("note").ilike(like),
    )


def list_summaries(
    session: Session,
    *,
    limit: int = DEFAULT_SUMMARY_PAGE_SIZE,
    offset: int = 0,
    search: str | None = None,
    user_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Return one newest-first page of summaries in the light projection.

    **This must not touch `tg_summary_payloads`.** It is the reason the table
    exists — pinned by `tests/services/test_summary_list_payload_cost.py`.

    `user_id` has no default for the reason `scoped_select` takes none: a
    defaulted `None` lets a call site forget the argument and still compile,
    and the seam would then have to invent a meaning for "no user".
    """
    statement = scoped_select(select(Summary), Summary, user_id)
    if search and search.strip():
        statement = statement.where(_search_clause(search.strip()))
    statement = (
        statement.order_by(col(Summary.timestamp).desc(), col(Summary.id))
        .offset(offset)
        .limit(limit)
    )
    return [summary_to_camel_light(s) for s in session.exec(statement).all()]


def get_summary(
    session: Session, summary_id: str, *, user_id: uuid.UUID
) -> dict[str, Any]:
    """One summary in full, including citedPosts/promptText/chatMessages.

    The payload row is fetched only after the parent's owner is accepted, so
    the heavy half stays unreachable for a foreign id — the read that matters
    is not always the one the function is named after.
    """
    row = session.get(Summary, summary_id)
    if row is None:
        raise HTTPException(status_code=404, detail=SUMMARY_NOT_FOUND)
    assert_owner(row.user_id, user_id, detail=SUMMARY_NOT_FOUND)
    return summary_to_camel(row, session.get(SummaryPayload, summary_id))


def apply_summary_payload(
    session: Session,
    summary_id: str,
    *,
    user_id: uuid.UUID,
    updates: dict[str, Any],
    removals: set[str] | None = None,
) -> SummaryPayload | None:
    """Store, update or clear one summary's heavy half.

    A summary with no heavy fields gets no payload row at all, and clearing the
    last one deletes the row, so the table never accumulates empty rows —
    the same rule `_upsert_sync_log_payload` follows.

    Returns the row as it now stands (`None` if there is none), so callers can
    derive `chat_message_count` / `prompt_excerpt` from what was actually
    written rather than from what they passed in.
    """
    existing = session.get(SummaryPayload, summary_id)
    removals = removals or set()
    if not updates and not removals:
        return existing

    row = existing or SummaryPayload(summary_id=summary_id, user_id=user_id)
    for column in removals:
        setattr(row, column, None)
    for column, value in updates.items():
        setattr(row, column, value)
    row.user_id = user_id
    row.updated_at = utc_now()

    if all(getattr(row, column) is None for column in _PAYLOAD_COLUMN_NAMES):
        if existing is not None:
            session.delete(existing)
        return None

    session.add(row)
    return row


def refresh_summary_derived_columns(
    summary: Summary, payload: SummaryPayload | None
) -> None:
    """Recompute the two columns that stand in for the heavy fields.

    Public because every write path has to call it — the aggregate, the
    importer, the auto-regenerate job — and a path that forgot would leave the
    list showing a stale count or preview with nothing to catch it.
    """
    summary.chat_message_count = _derive_chat_message_count(
        payload.chat_messages if payload else None
    )
    summary.prompt_excerpt = _derive_prompt_excerpt(
        payload.prompt_text if payload else None
    )


def upsert_summary(
    session: Session,
    summary_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Create a summary, or merge into the caller's existing one.

    `user_id` was already the owner stamp; ticket 17 makes it the authority as
    well. Without the check a second account overwrites the first's summary by
    naming its id, and every read guard still passes — the merge does not care
    whose row it landed on.

    An absent id still creates, which is what makes this an upsert. The check
    fires only on a row that exists and is somebody else's.
    """
    summary = session.get(Summary, summary_id)
    if summary is not None:
        assert_owner_on_write(summary.user_id, user_id, detail=SUMMARY_NOT_FOUND)
    known = {
        "id",
        "text",
        "channels",
        "start_date",
        "end_date",
        "startDate",
        "endDate",
        "language",
        "model",
        "post_count",
        "postCount",
        "timestamp",
    }
    payload_updates: dict[str, Any] = {}
    payload_removals: set[str] = set()
    #: Everything bound for `extra`, explicit nulls included — an update reads
    #: those as removals, a create stores them, and that asymmetry predates the
    #: split and is preserved by it.
    extra_from_body: dict[str, Any] = {}

    for key, value in body.items():
        snake = to_snake(key)
        if snake in known or key == "id":
            continue
        if snake in _PAYLOAD_COLUMN_NAMES:
            # Absent means "leave it alone", an explicit null means "remove" —
            # the same merge semantics these keys had inside `extra`, which is
            # what lets a client PUT back a list item without wiping the
            # corpus it never received.
            if value is None:
                payload_removals.add(snake)
            else:
                payload_updates[snake] = value
            continue
        if snake in DERIVED_SUMMARY_FIELDS:
            continue
        extra_from_body[key] = value

    if summary:
        for key, value in body.items():
            snake = to_snake(key)
            if snake in (
                "start_date",
                "end_date",
                "post_count",
                "text",
                "channels",
                "language",
                "model",
                "timestamp",
            ):
                setattr(summary, snake, value)
        merged_extra = {
            **(summary.extra or {}),
            **{k: v for k, v in extra_from_body.items() if v is not None},
        }
        for key, value in extra_from_body.items():
            if value is None:
                merged_extra.pop(key, None)
                merged_extra.pop(to_snake(key), None)
        summary.extra = merged_extra
        summary.updated_at = utc_now()
    else:
        summary = Summary(
            id=summary_id,
            user_id=user_id,
            text=body.get("text", ""),
            channels=body.get("channels", []),
            start_date=body.get("startDate", body.get("start_date", 0)),
            end_date=body.get("endDate", body.get("end_date", 0)),
            language=body.get("language", "English"),
            model=body.get("model"),
            post_count=body.get("postCount", body.get("post_count")),
            timestamp=body.get("timestamp", 0),
            extra=extra_from_body,
        )

    payload = apply_summary_payload(
        session,
        summary_id,
        user_id=summary.user_id,
        updates=payload_updates,
        removals=payload_removals,
    )
    refresh_summary_derived_columns(summary, payload)
    # Ticket 27: who wrote this, when it was not the account that owns it.
    # On the merge branch too, not only on creation — the column answers
    # "who made the *last* write", so a User editing their own row
    # afterwards has to clear an Owner's name off it.
    acting_owner.stamp(session, summary)
    session.add(summary)
    session.commit()
    session.refresh(summary)
    return summary_to_camel(summary, session.get(SummaryPayload, summary_id))


def delete_summary(session: Session, summary_id: str, *, user_id: uuid.UUID) -> None:
    summary = session.get(Summary, summary_id)
    if not summary:
        raise HTTPException(status_code=404, detail=SUMMARY_NOT_FOUND)
    assert_owner_on_write(summary.user_id, user_id, detail=SUMMARY_NOT_FOUND)
    session.delete(summary)
    # tg_summary_payloads has no FK to cascade from — see SummaryPayload.
    payload = session.get(SummaryPayload, summary_id)
    if payload:
        session.delete(payload)
    session.commit()
