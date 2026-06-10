"""Server-side data retention cleanup (replaces App.tsx 6h interval)."""

from __future__ import annotations

import logging
from datetime import datetime

from sqlmodel import Session, col, delete, func, or_, select

from app.jobs.settings import load_retention_settings
from app.services.operator import get_operator_user_id
from app.services.post_sync_state import prune_sync_state_below, prune_sync_state_for_post_ids
from app.services.sync_meta import touch_sync
from app.models_tg import (
    Channel,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    Post,
    PostEmbedding,
    PostTranslation,
    PublishLog,
    SyncLog,
)

logger = logging.getLogger(__name__)


def run_retention_cleanup(session: Session) -> dict[str, int]:
    settings = load_retention_settings(session)
    post_days = int(settings.get("postRetentionDays") or 0)
    log_days = int(settings.get("logRetentionDays") or 0)
    operator_id = get_operator_user_id(session)

    deleted_posts = 0
    deleted_logs = 0

    if post_days > 0:
        cutoff = int(datetime.utcnow().timestamp() * 1000) - post_days * 24 * 60 * 60 * 1000
        stmt = select(Post).where(
            col(Post.timestamp) < cutoff,
            col(Post.is_anchor) == False,  # noqa: E712
        )
        if operator_id is not None:
            stmt = stmt.where(
                or_(Post.user_id == operator_id, col(Post.user_id).is_(None))
            )
        old_posts = session.exec(stmt).all()
        deleted_post_ids_by_channel: dict[str, list[int]] = {}
        for post in old_posts:
            emb_id = f"{post.channel_name}_{post.post_id}"
            emb = session.get(PostEmbedding, emb_id)
            if emb:
                session.delete(emb)
            translations = session.exec(
                select(PostTranslation).where(
                    PostTranslation.channel_name == post.channel_name,
                    PostTranslation.post_id == post.post_id,
                )
            ).all()
            for t in translations:
                session.delete(t)
            session.delete(post)
            deleted_posts += 1
            deleted_post_ids_by_channel.setdefault(post.channel_name, []).append(
                post.post_id
            )
        if deleted_posts:
            for channel_name, post_ids in deleted_post_ids_by_channel.items():
                prune_sync_state_for_post_ids(session, channel_name, post_ids)
                min_remaining = session.exec(
                    select(func.min(Post.post_id)).where(
                        Post.channel_name == channel_name
                    )
                ).one()
                if min_remaining is not None:
                    prune_sync_state_below(session, channel_name, min_remaining)
                channel = session.exec(
                    select(Channel).where(Channel.name == channel_name)
                ).first()
                if channel and channel.anchor_post_id in post_ids:
                    channel.anchor_post_id = None
                    session.add(channel)
            session.commit()
            touch_sync(session, "posts")
            touch_sync(session, "embeddings")
            touch_sync(session, "translations")
            touch_sync(session, "channels")

    if log_days > 0:
        cutoff = int(datetime.utcnow().timestamp() * 1000) - log_days * 24 * 60 * 60 * 1000
        for model, resource in (
            (PublishLog, "publish_logs"),
            (SyncLog, "sync_logs"),
            (LLMLog, "llm_logs"),
            (EmbeddingLog, "embedding_logs"),
            (NetworkLog, "network_logs"),
        ):
            stmt = select(model).where(col(model.timestamp) < cutoff)  # type: ignore[arg-type]
            if operator_id is not None:
                stmt = stmt.where(
                    or_(model.user_id == operator_id, col(model.user_id).is_(None))  # type: ignore[attr-defined]
                )
            old_rows = session.exec(stmt).all()
            for row in old_rows:
                session.delete(row)
                deleted_logs += 1
            if old_rows:
                session.commit()
                touch_sync(session, resource)

    logger.info(
        "Retention cleanup: deleted %s posts, %s log rows (postDays=%s, logDays=%s)",
        deleted_posts,
        deleted_logs,
        post_days,
        log_days,
    )
    return {"deletedPosts": deleted_posts, "deletedLogs": deleted_logs}
