"""Server-side embedding backfill for posts missing vectors."""

from __future__ import annotations

import time
import uuid
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.ai.registry import get_provider
from app.core.config import settings
from app.models_tg import EmbeddingLog, Post, PostEmbedding, SyncMeta

_last_backfill_run_ms: int | None = None


def get_last_backfill_run() -> int | None:
    return _last_backfill_run_ms


def _touch_sync(session: Session, resource: str) -> None:
    meta = session.get(SyncMeta, resource)
    etag = str(uuid.uuid4())
    if meta:
        meta.etag = etag
        meta.updated_at = datetime.utcnow()
        session.add(meta)
    else:
        session.add(SyncMeta(resource=resource, etag=etag))
    session.commit()


def _posts_without_embeddings_stmt(
    limit: int | None = None,
    *,
    channel_names: set[str] | None = None,
):
    stmt = (
        select(Post)
        .outerjoin(
            PostEmbedding,
            (Post.channel_name == PostEmbedding.channel_name)
            & (Post.post_id == PostEmbedding.post_id),
        )
        .where(col(PostEmbedding.id).is_(None))
        .where(col(Post.is_anchor) == False)  # noqa: E712
        .order_by(Post.timestamp.desc())
    )
    if channel_names:
        stmt = stmt.where(col(Post.channel_name).in_(channel_names))
    if limit is not None:
        stmt = stmt.limit(limit)
    return stmt


def count_posts_without_embeddings(
    session: Session,
    *,
    channel_names: set[str] | None = None,
) -> int:
    if channel_names is not None and not channel_names:
        return 0
    stmt = (
        select(func.count())
        .select_from(Post)
        .outerjoin(
            PostEmbedding,
            (Post.channel_name == PostEmbedding.channel_name)
            & (Post.post_id == PostEmbedding.post_id),
        )
        .where(col(PostEmbedding.id).is_(None))
        .where(col(Post.is_anchor) == False)  # noqa: E712
    )
    if channel_names is not None:
        stmt = stmt.where(col(Post.channel_name).in_(channel_names))
    return int(session.exec(stmt).one())


def get_embedding_status(
    session: Session,
    *,
    channel_names: set[str] | None = None,
) -> dict[str, Any]:
    if channel_names is not None and not channel_names:
        return {
            "pending": 0,
            "total": 0,
            "lastRun": get_last_backfill_run(),
        }
    total_stmt = (
        select(func.count())
        .select_from(Post)
        .where(col(Post.is_anchor) == False)  # noqa: E712
    )
    if channel_names is not None:
        total_stmt = total_stmt.where(col(Post.channel_name).in_(channel_names))
    total = int(session.exec(total_stmt).one())
    pending = count_posts_without_embeddings(session, channel_names=channel_names)
    return {
        "pending": pending,
        "total": total,
        "lastRun": get_last_backfill_run(),
    }


async def backfill_embeddings(
    session: Session,
    *,
    limit: int | None = None,
    operator_id: UUID | None = None,
) -> dict[str, Any]:
    """Embed up to *limit* posts that lack a PostEmbedding row."""
    global _last_backfill_run_ms

    if limit is None:
        limit = settings.EMBEDDINGS_BACKFILL_LIMIT_DEFAULT

    if not settings.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not configured")

    from app.services.channels import channel_names_for_operator

    operator_channels = channel_names_for_operator(session, operator_id)
    posts = session.exec(
        _posts_without_embeddings_stmt(limit, channel_names=operator_channels or None)
    ).all()
    if not posts:
        _last_backfill_run_ms = int(time.time() * 1000)
        return {
            "processed": 0,
            "upserted": 0,
            "pending": count_posts_without_embeddings(
                session, channel_names=operator_channels or None
            ),
        }

    provider = get_provider("gemini")
    model = settings.EMBEDDING_MODEL
    upserted = 0
    start = time.perf_counter()

    try:
        chunk_size = settings.EMBEDDINGS_CHUNK_SIZE
        for i in range(0, len(posts), chunk_size):
            chunk = posts[i : i + chunk_size]
            texts = [p.text or p.channel_name for p in chunk]
            result = await provider.embed(texts, model=model)

            for post, vector in zip(chunk, result.vectors, strict=True):
                emb_id = f"{post.channel_name}_{post.post_id}"
                existing = session.get(PostEmbedding, emb_id)
                if existing:
                    existing.vector = vector
                    existing.text = post.text
                    existing.provider = result.provider
                    existing.model = result.model
                    existing.dimensions = result.dimensions
                    existing.updated_at = datetime.utcnow()
                    session.add(existing)
                else:
                    session.add(
                        PostEmbedding(
                            id=emb_id,
                            channel_name=post.channel_name,
                            post_id=post.post_id,
                            vector=vector,
                            text=post.text,
                            provider=result.provider,
                            model=result.model,
                            dimensions=result.dimensions,
                        )
                    )
                upserted += 1

            session.commit()

        duration = time.perf_counter() - start
        session.add(
            EmbeddingLog(
                id=str(uuid.uuid4()),
                text_count=upserted,
                duration=round(duration, 3),
                status="success",
                timestamp=int(time.time() * 1000),
            )
        )
        session.commit()
        if upserted:
            _touch_sync(session, "embeddings")
    except Exception as exc:
        duration = time.perf_counter() - start
        session.add(
            EmbeddingLog(
                id=str(uuid.uuid4()),
                text_count=0,
                duration=round(duration, 3),
                status="failed",
                error=str(exc),
                timestamp=int(time.time() * 1000),
            )
        )
        session.commit()
        raise

    _last_backfill_run_ms = int(time.time() * 1000)
    return {
        "processed": len(posts),
        "upserted": upserted,
        "pending": count_posts_without_embeddings(
            session, channel_names=operator_channels or None
        ),
    }
