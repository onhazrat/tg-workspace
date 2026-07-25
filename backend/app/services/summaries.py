"""Summary CRUD helpers for TG Summarizer data APIs."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Text, cast, or_
from sqlmodel import Session, col, select

from app.models_tg import Summary, utc_now
from app.services.serialization import to_snake

DEFAULT_SUMMARY_PAGE_SIZE = 200
MAX_SUMMARY_PAGE_SIZE = 2000


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


def summary_to_camel(summary: Summary) -> dict[str, Any]:
    return {**_summary_base(summary), **(summary.extra or {})}


# Fields stored in `extra` that carry a whole corpus rather than metadata.
# `citedPosts` embeds full Post objects, `promptText` a serialized post corpus,
# `chatMessages` an entire conversation.
HEAVY_SUMMARY_FIELDS = frozenset({"citedPosts", "promptText", "chatMessages"})

# Matches truncatePreview's default in frontend/src/lib/commands/search-filters.ts.
SUMMARY_PROMPT_EXCERPT_CHARS = 80


def summary_to_camel_light(summary: Summary) -> dict[str, Any]:
    """List-view projection: everything except the corpus-sized fields.

    Drops only `HEAVY_SUMMARY_FIELDS` and keeps the rest of `extra` — the small
    flags (`isStarred`, `autoPublish`, `note`, …) are what the history and
    search list surfaces render, so an allowlist would silently lose them as
    new flags are added.

    Two derived fields stand in for dropped ones: `chatMessageCount` (HistoryView
    only shows the count) and `promptExcerpt` (the palette only shows a
    truncated preview).
    """
    extra = summary.extra or {}
    light = {k: v for k, v in extra.items() if k not in HEAVY_SUMMARY_FIELDS}

    chat_messages = extra.get("chatMessages")
    light["chatMessageCount"] = (
        len(chat_messages) if isinstance(chat_messages, list) else 0
    )

    prompt_text = extra.get("promptText")
    if isinstance(prompt_text, str) and prompt_text:
        collapsed = " ".join(prompt_text.split())
        light["promptExcerpt"] = (
            collapsed
            if len(collapsed) <= SUMMARY_PROMPT_EXCERPT_CHARS
            else collapsed[: SUMMARY_PROMPT_EXCERPT_CHARS - 1] + "…"
        )

    return {**_summary_base(summary), **light}


def _search_clause(term: str) -> Any:
    """Case-insensitive substring match, mirroring the previous client filter.

    Fields are extracted individually rather than matching `extra::text` as a
    blob: `extra` also holds `citedPosts`, so a blob match would hit the body
    text of cited posts and return summaries the old client-side filter never
    would have.
    """
    like = f"%{term}%"
    extra = col(Summary.extra)
    return or_(
        col(Summary.text).ilike(like),
        cast(col(Summary.channels), Text).ilike(like),
        col(Summary.model).ilike(like),
        extra.op("->>")("promptText").ilike(like),
        extra.op("->>")("note").ilike(like),
    )


def list_summaries(
    session: Session,
    *,
    limit: int = DEFAULT_SUMMARY_PAGE_SIZE,
    offset: int = 0,
    search: str | None = None,
) -> list[dict[str, Any]]:
    """Return one newest-first page of summaries in the light projection.

    `search` runs in SQL so prompt bodies stay searchable without shipping
    them: `promptText` is ~94% of what this endpoint used to return.
    """
    statement = select(Summary)
    if search and search.strip():
        statement = statement.where(_search_clause(search.strip()))
    statement = (
        statement.order_by(col(Summary.timestamp).desc(), col(Summary.id))
        .offset(offset)
        .limit(limit)
    )
    return [summary_to_camel_light(s) for s in session.exec(statement).all()]


def get_summary(session: Session, summary_id: str) -> dict[str, Any]:
    """One summary in full, including citedPosts/promptText/chatMessages."""
    row = session.get(Summary, summary_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Summary not found")
    return summary_to_camel(row)


def upsert_summary(
    session: Session,
    summary_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID | None,
) -> dict[str, Any]:
    summary = session.get(Summary, summary_id)
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
        extra_updates: dict[str, Any] = {}
        extra_removals: list[str] = []
        for key, value in body.items():
            snake = to_snake(key)
            if snake in known or key == "id":
                continue
            if value is None:
                extra_removals.extend({key, snake})
            else:
                extra_updates[key] = value
        merged_extra = {**(summary.extra or {}), **extra_updates}
        for key in extra_removals:
            merged_extra.pop(key, None)
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
            extra={
                key: value for key, value in body.items() if to_snake(key) not in known
            },
        )
    session.add(summary)
    session.commit()
    session.refresh(summary)
    return summary_to_camel(summary)


def delete_summary(session: Session, summary_id: str) -> None:
    summary = session.get(Summary, summary_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not found")
    session.delete(summary)
    session.commit()
