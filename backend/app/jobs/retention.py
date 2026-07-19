"""Server-side data retention cleanup (replaces App.tsx 6h interval)."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, cast

from sqlalchemy import delete as sa_delete
from sqlmodel import Session, col, func, or_, select

from app.jobs.settings import load_media_settings, load_retention_settings
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
from app.services.operator import get_operator_user_id
from app.services.post_sync_state import (
    prune_sync_state_below,
    prune_sync_state_for_post_ids,
)
from app.services.post_thumbnails import (
    delete_cached_thumb,
    enforce_thumb_cache_size_limit,
)
from app.services.sync_meta import touch_sync

logger = logging.getLogger(__name__)

# Delete expired posts in bounded batches: a backlog can be hundreds of
# thousands of rows, and materialising them all at once OOM-killed the worker.
POST_DELETE_BATCH = 500


def run_retention_cleanup(session: Session) -> dict[str, int]:
    settings = load_retention_settings(session)
    post_days = int(settings.get("postRetentionDays") or 0)
    log_days = int(settings.get("logRetentionDays") or 0)
    operator_id = get_operator_user_id(session)

    deleted_posts = 0
    deleted_logs = 0

    # Logs first: they are the heaviest tables (tg_sync_logs full_response is
    # ~17KB/row, up to 3MB) and the cheapest to clear, so do them before the
    # slower per-post work in case the latter is interrupted.
    if log_days > 0:
        cutoff = (
            int(datetime.utcnow().timestamp() * 1000) - log_days * 24 * 60 * 60 * 1000
        )
        for model_cls, resource in (
            (PublishLog, "publish_logs"),
            (SyncLog, "sync_logs"),
            (LLMLog, "llm_logs"),
            (EmbeddingLog, "embedding_logs"),
            (NetworkLog, "network_logs"),
        ):
            timestamp_col = cast(Any, model_cls).timestamp
            # Bulk SQL DELETE, not select-all-then-ORM-delete: materialising
            # every expired row pulled gigabytes into the worker and OOM-killed
            # it. This deletes in the database without loading any row.
            del_stmt = sa_delete(model_cls).where(col(timestamp_col) < cutoff)
            if operator_id is not None:
                user_id_col = cast(Any, model_cls).user_id
                del_stmt = del_stmt.where(
                    or_(col(user_id_col) == operator_id, col(user_id_col).is_(None))
                )
            result = session.execute(del_stmt)
            session.commit()
            deleted = cast(Any, result).rowcount or 0
            if deleted:
                deleted_logs += deleted
                touch_sync(session, resource)

    if post_days > 0:
        cutoff = (
            int(datetime.utcnow().timestamp() * 1000) - post_days * 24 * 60 * 60 * 1000
        )
        affected_channels: set[str] = set()
        # Page through the backlog: select a bounded batch, delete it and its
        # dependents in bulk, commit, repeat. Memory stays flat regardless of
        # how far behind retention is.
        while True:
            batch_stmt = select(Post).where(
                col(Post.timestamp) < cutoff,
                col(Post.is_anchor) == False,  # noqa: E712
            )
            if operator_id is not None:
                batch_stmt = batch_stmt.where(
                    or_(Post.user_id == operator_id, col(Post.user_id).is_(None))
                )
            batch = session.exec(batch_stmt.limit(POST_DELETE_BATCH)).all()
            if not batch:
                break

            ids_by_channel: dict[str, list[int]] = {}
            for post in batch:
                ids_by_channel.setdefault(post.channel_name, []).append(post.post_id)
                # Thumbnails live on disk, so they still have to be cleared one
                # by one; everything else is deleted per channel in bulk below.
                delete_cached_thumb(post.channel_name, post.post_id)

            for channel_name, post_ids in ids_by_channel.items():
                session.execute(
                    sa_delete(PostEmbedding).where(
                        col(PostEmbedding.channel_name) == channel_name,
                        col(PostEmbedding.post_id).in_(post_ids),
                    )
                )
                session.execute(
                    sa_delete(PostTranslation).where(
                        col(PostTranslation.channel_name) == channel_name,
                        col(PostTranslation.post_id).in_(post_ids),
                    )
                )
                prune_sync_state_for_post_ids(session, channel_name, post_ids)
                result = session.execute(
                    sa_delete(Post).where(
                        col(Post.channel_name) == channel_name,
                        col(Post.post_id).in_(post_ids),
                    )
                )
                deleted_posts += cast(Any, result).rowcount or 0
                affected_channels.add(channel_name)
            session.commit()

        if affected_channels:
            for channel_name in affected_channels:
                min_remaining = session.exec(
                    select(func.min(Post.post_id)).where(
                        Post.channel_name == channel_name
                    )
                ).one()
                if min_remaining is not None:
                    prune_sync_state_below(session, channel_name, min_remaining)
                # Drop a dangling anchor whose post was pruned so the channel
                # does not point at a row that no longer exists.
                channel = session.exec(
                    select(Channel).where(Channel.name == channel_name)
                ).first()
                if channel and channel.anchor_post_id is not None:
                    anchor_exists = session.exec(
                        select(Post.post_id).where(
                            Post.channel_name == channel_name,
                            Post.post_id == channel.anchor_post_id,
                        )
                    ).first()
                    if anchor_exists is None:
                        channel.anchor_post_id = None
                        session.add(channel)
            session.commit()
            touch_sync(session, "posts")
            touch_sync(session, "embeddings")
            touch_sync(session, "translations")
            touch_sync(session, "channels")

    media_settings = load_media_settings(session)
    max_mb = int(media_settings.get("thumbCacheMaxSizeMb") or 0)
    if max_mb > 0:
        enforce_thumb_cache_size_limit(max_mb)

    logger.info(
        "Retention cleanup: deleted %s posts, %s log rows (postDays=%s, logDays=%s)",
        deleted_posts,
        deleted_logs,
        post_days,
        log_days,
    )
    return {"deletedPosts": deleted_posts, "deletedLogs": deleted_logs}
