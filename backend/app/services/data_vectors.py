"""Embedding and translation list/upsert (extracted from data routes)."""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, col, select

from app.models_tg import PostEmbedding, PostTranslation, utc_now
from app.services.serialization import (
    normalize_body,
    translation_to_camel,
)
from app.services.sync_meta import touch_sync

DEFAULT_VECTOR_PAGE_SIZE = 500
MAX_VECTOR_PAGE_SIZE = 5000


def upsert_embeddings(session: Session, body: list[dict[str, Any]]) -> dict[str, int]:
    count = 0
    for item in body:
        eid = item.get("id", "")
        normalized = normalize_body(item)
        existing = session.get(PostEmbedding, eid) if eid else None
        if existing:
            existing.channel_name = normalized.get(
                "channel_name", existing.channel_name
            )
            existing.post_id = normalized.get("post_id", existing.post_id)
            existing.vector = normalized.get("vector", existing.vector)
            existing.text = normalized.get("text", existing.text)
            existing.provider = normalized.get("provider", existing.provider)
            existing.model = normalized.get("model", existing.model)
            existing.dimensions = normalized.get("dimensions", existing.dimensions)
            existing.updated_at = utc_now()
            session.add(existing)
        else:
            session.add(
                PostEmbedding(
                    id=eid
                    or f"{normalized.get('channel_name')}_{normalized.get('post_id')}",
                    channel_name=normalized.get("channel_name", ""),
                    post_id=int(normalized.get("post_id", 0)),
                    vector=normalized.get("vector", []),
                    text=normalized.get("text", ""),
                    provider=normalized.get("provider", "gemini"),
                    model=normalized.get("model", ""),
                    dimensions=normalized.get("dimensions", 0),
                )
            )
        count += 1
    session.commit()
    touch_sync(session, "embeddings")
    return {"upserted": count}


def list_translations(
    session: Session,
    *,
    limit: int = DEFAULT_VECTOR_PAGE_SIZE,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Return one page of translations, newest first.

    Ordering by `timestamp DESC` keeps offset paging from repeating or
    skipping rows. Reading a single translation should go through
    `get_translation` rather than paging this.
    """
    stmt = (
        select(PostTranslation)
        .order_by(col(PostTranslation.timestamp).desc(), col(PostTranslation.id))
        .offset(offset)
        .limit(limit)
    )
    return [translation_to_camel(t) for t in session.exec(stmt).all()]


def get_translation(
    session: Session, *, channel_name: str, post_id: int, language: str
) -> dict[str, Any] | None:
    """Fetch one translation by its natural key, or None.

    The frontend used to download the whole translation table to read a single
    row — made worse by every save bumping the sync etag, forcing the next read
    to re-download everything.
    """
    stmt = select(PostTranslation).where(
        col(PostTranslation.channel_name) == channel_name,
        col(PostTranslation.post_id) == post_id,
        col(PostTranslation.language) == language,
    )
    row = session.exec(stmt).first()
    return translation_to_camel(row) if row else None


def upsert_translations(session: Session, body: list[dict[str, Any]]) -> dict[str, int]:
    count = 0
    for item in body:
        tid = item.get("id", "")
        normalized = normalize_body(item)
        existing = session.get(PostTranslation, tid) if tid else None
        if existing:
            existing.translated_text = normalized.get(
                "translated_text", existing.translated_text
            )
            existing.timestamp = normalized.get("timestamp", existing.timestamp)
            existing.updated_at = utc_now()
            session.add(existing)
        else:
            session.add(
                PostTranslation(
                    id=tid
                    or f"{normalized.get('channel_name')}_{normalized.get('post_id')}_{normalized.get('language')}",
                    channel_name=normalized.get("channel_name", ""),
                    post_id=int(normalized.get("post_id", 0)),
                    language=normalized.get("language", ""),
                    translated_text=normalized.get("translated_text", ""),
                    timestamp=normalized.get("timestamp", 0),
                )
            )
        count += 1
    session.commit()
    touch_sync(session, "translations")
    return {"upserted": count}
