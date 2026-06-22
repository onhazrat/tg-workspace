"""Embedding and translation list/upsert (extracted from data routes)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlmodel import Session, select

from app.models_tg import PostEmbedding, PostTranslation
from app.services.serialization import (
    embedding_to_camel,
    normalize_body,
    translation_to_camel,
)
from app.services.sync_meta import touch_sync


def list_embeddings(session: Session) -> list[dict[str, Any]]:
    return [embedding_to_camel(e) for e in session.exec(select(PostEmbedding)).all()]


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
            existing.updated_at = datetime.utcnow()
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


def list_translations(session: Session) -> list[dict[str, Any]]:
    return [
        translation_to_camel(t) for t in session.exec(select(PostTranslation)).all()
    ]


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
            existing.updated_at = datetime.utcnow()
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
