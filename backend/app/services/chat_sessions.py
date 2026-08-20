"""Chat session CRUD helpers for TG Summarizer data APIs.

A chat session is stored as **two rows**: `ChatSession` (the base columns plus a
small open `extra` bag) and `ChatSessionPayload` (the transcript). That split is
what makes listing cheap — see the `ChatSessionPayload` docstring for the
measurements behind it. This module owns both tables and is the only place that
knows they are two.

Deliberately a near-copy of `app.services.summaries`. Chats and summaries are
siblings: same scope columns, same list-vs-detail split, same derived-column
trick. Where this module differs from that one, there is a comment saying why.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Text, cast, or_
from sqlmodel import Session, col, select

from app.models_tg import ChatSession, ChatSessionPayload, utc_now
from app.services.serialization import to_snake

DEFAULT_CHAT_SESSION_PAGE_SIZE = 200
MAX_CHAT_SESSION_PAGE_SIZE = 2000

#: Wire key -> `ChatSessionPayload` column for the corpus-sized fields.
PAYLOAD_COLUMNS: dict[str, str] = {"messages": "messages"}

HEAVY_CHAT_FIELDS = frozenset(PAYLOAD_COLUMNS)
_PAYLOAD_COLUMN_NAMES = frozenset(PAYLOAD_COLUMNS.values())

#: Maintained from the payload on write. Stripped from inbound bodies so a
#: client round-tripping a list item cannot shadow them with a stale value.
DERIVED_CHAT_FIELDS = frozenset({"message_count", "title"})

#: Matches `SUMMARY_PROMPT_EXCERPT_CHARS`. The title is the one line that
#: distinguishes this chat from its siblings in a list, not a summary of it.
CHAT_TITLE_CHARS = 80

#: The two ways a chat sources its posts. `full_scope` sends every post in the
#: scope; `semantic` sends only what a vector search retrieved for the question.
CHAT_MODES = ("full_scope", "semantic")


def derive_chat_title(messages: Any) -> str:
    """The first user message, whitespace-collapsed and truncated.

    This is what the `"Chat: "` prefix used to carry after its first six
    characters. Empty string rather than `None` when there is nothing to derive:
    `title` is non-null on the wire so no consumer needs `?? ""`.
    """
    if not isinstance(messages, list):
        return ""
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        text = message.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        collapsed = " ".join(text.split())
        if len(collapsed) <= CHAT_TITLE_CHARS:
            return collapsed
        return collapsed[: CHAT_TITLE_CHARS - 1] + "…"
    return ""


def _derive_message_count(messages: Any) -> int:
    return len(messages) if isinstance(messages, list) else 0


def _chat_session_base(row: ChatSession) -> dict[str, Any]:
    return {
        "id": row.id,
        "title": row.title,
        "channels": row.channels,
        "startDate": row.start_date,
        "endDate": row.end_date,
        "language": row.language,
        "model": row.model,
        "mode": row.mode,
        "postCount": row.post_count,
        "timestamp": row.timestamp,
    }


def chat_session_to_camel(
    row: ChatSession, payload: ChatSessionPayload | None = None
) -> dict[str, Any]:
    """Full projection, reassembling the two rows into one flat object.

    Unlike `summary_to_camel`, `messages` is **always** emitted — as `[]` when
    there is no payload row. Summaries had a wire format to preserve
    byte-for-byte, where an absent heavy key had to stay absent. This format is
    new, and a transcript that is a missing key rather than an empty list would
    put `?? []` in every consumer.
    """
    messages = payload.messages if payload is not None else None
    return {
        **_chat_session_base(row),
        **(row.extra or {}),
        "messages": messages if isinstance(messages, list) else [],
    }


def chat_session_to_camel_light(row: ChatSession) -> dict[str, Any]:
    """List-view projection — everything the base row holds, and nothing else.

    Reads `ChatSession` alone. The transcript is in another table, and the two
    things a list shows of it (`title`, `messageCount`) are columns here,
    maintained on write.
    """
    light = dict(row.extra or {})
    light["messageCount"] = row.message_count
    return {**_chat_session_base(row), **light}


def _search_clause(term: str) -> Any:
    """Case-insensitive substring match over the columns the list can read.

    Deliberately does **not** reach the transcript. Summaries reach prompt
    bodies through an `EXISTS` against their payload table; here the title
    already carries the first user message, which is the part someone searching
    their chat history is actually looking for, and matching whole transcripts
    would make every chat that mentioned a word a hit for it.
    """
    like = f"%{term}%"
    return or_(
        col(ChatSession.title).ilike(like),
        cast(col(ChatSession.channels), Text).ilike(like),
        col(ChatSession.model).ilike(like),
        col(ChatSession.extra).op("->>")("note").ilike(like),
    )


def list_chat_sessions(
    session: Session,
    *,
    limit: int = DEFAULT_CHAT_SESSION_PAGE_SIZE,
    offset: int = 0,
    search: str | None = None,
) -> list[dict[str, Any]]:
    """One newest-first page of chat sessions in the light projection.

    **This must not touch `tg_chat_session_payloads`.** It is the reason the
    table exists — pinned by
    `tests/services/test_chat_session_payload_cost.py`.
    """
    statement = select(ChatSession)
    if search and search.strip():
        statement = statement.where(_search_clause(search.strip()))
    statement = (
        statement.order_by(col(ChatSession.timestamp).desc(), col(ChatSession.id))
        .offset(offset)
        .limit(limit)
    )
    return [chat_session_to_camel_light(row) for row in session.exec(statement).all()]


def get_chat_session(session: Session, chat_session_id: str) -> dict[str, Any]:
    """One chat session in full, including the transcript."""
    row = session.get(ChatSession, chat_session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return chat_session_to_camel(row, session.get(ChatSessionPayload, chat_session_id))


def apply_chat_session_payload(
    session: Session,
    chat_session_id: str,
    *,
    user_id: uuid.UUID | None,
    updates: dict[str, Any],
    removals: set[str] | None = None,
) -> ChatSessionPayload | None:
    """Store, update or clear one chat's transcript.

    A chat with no transcript gets no payload row at all, and clearing it
    deletes the row, so the table never accumulates empty rows — the same rule
    `apply_summary_payload` follows.

    Returns the row as it now stands (`None` if there is none), so callers
    derive `title` / `message_count` from what was actually written rather than
    from what they passed in.
    """
    existing = session.get(ChatSessionPayload, chat_session_id)
    removals = removals or set()
    if not updates and not removals:
        return existing

    row = existing or ChatSessionPayload(chat_session_id=chat_session_id)
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


def refresh_chat_session_derived_columns(
    row: ChatSession, payload: ChatSessionPayload | None
) -> None:
    """Recompute the two columns that stand in for the transcript.

    Public because every write path has to call it — the aggregate, the
    importer, the backfill script — and a path that forgot would leave the list
    showing a stale count or title with nothing to catch it.
    """
    messages = payload.messages if payload else None
    row.message_count = _derive_message_count(messages)
    #: An explicit title in the body wins; otherwise derive one. That matters
    #: for the backfill, which knows the old `"Chat: …"` text and should not
    #: re-derive a different title from the transcript.
    if not row.title:
        row.title = derive_chat_title(messages)


def upsert_chat_session(
    session: Session,
    chat_session_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID | None,
) -> dict[str, Any]:
    row = session.get(ChatSession, chat_session_id)
    known = {
        "id",
        "title",
        "channels",
        "start_date",
        "end_date",
        "startDate",
        "endDate",
        "language",
        "model",
        "mode",
        "post_count",
        "postCount",
        "timestamp",
    }
    payload_updates: dict[str, Any] = {}
    payload_removals: set[str] = set()
    extra_from_body: dict[str, Any] = {}

    for key, value in body.items():
        snake = to_snake(key)
        if snake in known or key == "id":
            continue
        if snake in _PAYLOAD_COLUMN_NAMES:
            # Absent means "leave it alone", an explicit null means "remove" —
            # the same merge semantics summaries use, which is what lets a
            # client PUT back a list item without wiping the transcript it never
            # received.
            if value is None:
                payload_removals.add(snake)
            else:
                payload_updates[snake] = value
            continue
        if snake in DERIVED_CHAT_FIELDS:
            continue
        extra_from_body[key] = value

    if row:
        for key, value in body.items():
            snake = to_snake(key)
            if snake in (
                "start_date",
                "end_date",
                "post_count",
                "title",
                "channels",
                "language",
                "model",
                "mode",
                "timestamp",
            ):
                setattr(row, snake, value)
        merged_extra = {
            **(row.extra or {}),
            **{k: v for k, v in extra_from_body.items() if v is not None},
        }
        for key, value in extra_from_body.items():
            if value is None:
                merged_extra.pop(key, None)
                merged_extra.pop(to_snake(key), None)
        row.extra = merged_extra
        row.updated_at = utc_now()
    else:
        row = ChatSession(
            id=chat_session_id,
            user_id=user_id,
            title=body.get("title", ""),
            channels=body.get("channels", []),
            start_date=body.get("startDate", body.get("start_date", 0)),
            end_date=body.get("endDate", body.get("end_date", 0)),
            language=body.get("language", "English"),
            model=body.get("model"),
            mode=body.get("mode", "full_scope"),
            post_count=body.get("postCount", body.get("post_count")),
            timestamp=body.get("timestamp", 0),
            extra=extra_from_body,
        )

    payload = apply_chat_session_payload(
        session,
        chat_session_id,
        user_id=row.user_id,
        updates=payload_updates,
        removals=payload_removals,
    )
    refresh_chat_session_derived_columns(row, payload)
    session.add(row)
    session.commit()
    session.refresh(row)
    return chat_session_to_camel(row, session.get(ChatSessionPayload, chat_session_id))


def delete_chat_session(session: Session, chat_session_id: str) -> None:
    row = session.get(ChatSession, chat_session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Chat session not found")
    session.delete(row)
    # tg_chat_session_payloads has no FK to cascade from — see the model.
    payload = session.get(ChatSessionPayload, chat_session_id)
    if payload:
        session.delete(payload)
    session.commit()
