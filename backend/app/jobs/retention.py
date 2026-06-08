"""Server-side data retention cleanup (replaces App.tsx 6h interval)."""

from __future__ import annotations

import logging
from datetime import datetime

from sqlmodel import Session, col, select

from app.api.routes.data import _touch_sync
from app.jobs.settings import load_retention_settings
from app.models_tg import (
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

    deleted_posts = 0
    deleted_logs = 0

    if post_days > 0:
        cutoff = int(datetime.utcnow().timestamp() * 1000) - post_days * 24 * 60 * 60 * 1000
        old_posts = session.exec(select(Post).where(col(Post.timestamp) < cutoff)).all()
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
        if deleted_posts:
            session.commit()
            _touch_sync(session, "posts")
            _touch_sync(session, "embeddings")
            _touch_sync(session, "translations")

    if log_days > 0:
        cutoff = int(datetime.utcnow().timestamp() * 1000) - log_days * 24 * 60 * 60 * 1000
        for model, resource in (
            (PublishLog, "publish_logs"),
            (SyncLog, "sync_logs"),
            (LLMLog, "llm_logs"),
            (EmbeddingLog, "embedding_logs"),
            (NetworkLog, "network_logs"),
        ):
            old_rows = session.exec(select(model).where(col(model.timestamp) < cutoff)).all()  # type: ignore[arg-type]
            for row in old_rows:
                session.delete(row)
                deleted_logs += 1
            if old_rows:
                session.commit()
                _touch_sync(session, resource)

    logger.info(
        "Retention cleanup: deleted %s posts, %s log rows (postDays=%s, logDays=%s)",
        deleted_posts,
        deleted_logs,
        post_days,
        log_days,
    )
    return {"deletedPosts": deleted_posts, "deletedLogs": deleted_logs}
