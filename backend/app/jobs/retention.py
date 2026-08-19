"""Server-side data retention cleanup (replaces App.tsx 6h interval)."""

from __future__ import annotations

import logging
from typing import Any, cast

from sqlalchemy import delete as sa_delete
from sqlmodel import Session, col, func, or_, select

# Aliased: `run_retention_cleanup` binds a local `settings` to the operator's
# runtime retention values, which would shadow the process settings object.
from app.core.config import settings as app_settings
from app.jobs.settings import load_media_settings, load_retention_settings
from app.models_tg import (
    Channel,
    DiscoverReport,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    Post,
    PostEmbedding,
    PostTranslation,
    PublishLog,
    SyncLog,
    utc_now,
)
from app.services.channel_photos import photo_stem, prune_orphaned_photos
from app.services.logs import expire_sync_payloads_stmt
from app.services.operator import get_operator_user_id
from app.services.post_sync_state import (
    prune_sync_state_below,
    prune_sync_state_for_post_ids,
)
from app.services.post_thumbnails import (
    delete_cached_thumb,
    enforce_thumb_cache_size_limit,
)
from app.services.scraper_jobs import prune_finished_jobs
from app.services.sync_meta import touch_sync

logger = logging.getLogger(__name__)

# Delete expired posts in bounded batches: a backlog can be hundreds of
# thousands of rows, and materialising them all at once OOM-killed the worker.
POST_DELETE_BATCH = 500


def _prune_discover_reports(session: Session, *, max_days: int, max_count: int) -> int:
    """Trim saved Discover reports by age, then by count.

    Reports are the one table that grows per user action with no natural bound:
    each Generate stores its whole candidate list, single-reference tail included,
    as a JSON blob. Nothing else prunes them.

    Both caps apply and 0 disables either, matching the post and log windows. The
    count cap is what actually bounds size — an age window alone lets a burst of
    reports generated in one afternoon survive in full.

    There is deliberately no floor: if the policy says the newest report goes, it
    goes, and Discover shows its empty state prompting a Generate. Setting the
    values to 0 is how you opt out, rather than the job second-guessing them.
    """
    deleted = 0

    if max_days > 0:
        cutoff = int(utc_now().timestamp() * 1000) - max_days * 24 * 60 * 60 * 1000
        result = session.execute(
            sa_delete(DiscoverReport).where(col(DiscoverReport.timestamp) < cutoff)
        )
        session.commit()
        deleted += cast(Any, result).rowcount or 0

    if max_count > 0:
        # Ids of everything past the newest N, then one bulk delete. The blob
        # column is never loaded — only the ids are selected.
        stale = session.exec(
            select(DiscoverReport.id)
            .order_by(col(DiscoverReport.timestamp).desc(), col(DiscoverReport.id))
            .offset(max_count)
        ).all()
        if stale:
            result = session.execute(
                sa_delete(DiscoverReport).where(col(DiscoverReport.id).in_(stale))
            )
            session.commit()
            deleted += cast(Any, result).rowcount or 0

    return deleted


def run_retention_cleanup(session: Session) -> dict[str, int]:
    settings = load_retention_settings(session)
    post_days = int(settings.get("postRetentionDays") or 0)
    log_days = int(settings.get("logRetentionDays") or 0)
    payload_days = int(settings.get("payloadRetentionDays") or 0)
    operator_id = get_operator_user_id(session)

    deleted_posts = 0
    deleted_logs = 0
    deleted_payloads = 0

    # Logs first: they are the heaviest tables (tg_sync_logs full_response is
    # ~17KB/row, up to 3MB) and the cheapest to clear, so do them before the
    # slower per-post work in case the latter is interrupted.
    if log_days > 0:
        cutoff = int(utc_now().timestamp() * 1000) - log_days * 24 * 60 * 60 * 1000
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
            if model_cls is SyncLog:
                # tg_sync_log_payloads has no FK to cascade from, so sweep it at
                # the log cutoff too. Without this, an operator who disables
                # payload retention (0 = never) while keeping a finite log
                # window would strand payloads whose log row is already gone.
                payload_result = session.execute(
                    expire_sync_payloads_stmt(cutoff, operator_id)
                )
                deleted_payloads += cast(Any, payload_result).rowcount or 0
            session.commit()
            deleted = cast(Any, result).rowcount or 0
            if deleted:
                deleted_logs += deleted
                touch_sync(session, resource)

    # Payloads expire on their own, shorter horizon: the bodies are the bulk of
    # a sync log, so discarding them early keeps a long audit trail cheap.
    if payload_days > 0:
        payload_cutoff = (
            int(utc_now().timestamp() * 1000) - payload_days * 24 * 60 * 60 * 1000
        )
        payload_result = session.execute(
            expire_sync_payloads_stmt(payload_cutoff, operator_id)
        )
        session.commit()
        expired = cast(Any, payload_result).rowcount or 0
        if expired:
            deleted_payloads += expired
            touch_sync(session, "sync_logs")

    if post_days > 0:
        cutoff = int(utc_now().timestamp() * 1000) - post_days * 24 * 60 * 60 * 1000
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

    deleted_reports = _prune_discover_reports(
        session,
        max_days=int(settings.get("reportRetentionDays") or 0),
        max_count=int(settings.get("reportRetentionMax") or 0),
    )
    if deleted_reports:
        touch_sync(session, "discover_reports")

    # Sync jobs are the one table here with no operator-facing window: nothing
    # lists them, so the horizon is a deployment constant. See
    # `prune_finished_jobs` — terminal rows only, so a long sync is never
    # deleted out from under the client reading its progress.
    deleted_sync_jobs = prune_finished_jobs(
        session, max_age_days=app_settings.SYNC_JOB_RETENTION_DAYS
    )

    media_settings = load_media_settings(session)
    max_mb = int(media_settings.get("thumbCacheMaxSizeMb") or 0)
    if max_mb > 0:
        enforce_thumb_cache_size_limit(max_mb)

    # Avatars, unlike thumbs, are bounded by channel count once the unreferenced
    # ones go, so this sweeps orphans rather than enforcing a size cap: a cap
    # would evict live avatars while leaving the actual garbage in place.
    #
    # Ids only — the sweep needs 2k strings, not 2k hydrated Channel rows.
    channel_ids = cast(list[str], session.exec(select(Channel.id)).all())
    deleted_photos = prune_orphaned_photos(
        {photo_stem(cid) for cid in channel_ids},
        max_age_days=app_settings.CHANNEL_PHOTO_ORPHAN_MAX_AGE_DAYS,
    )

    logger.info(
        "Retention cleanup: deleted %s posts, %s log rows, %s sync payloads, "
        "%s reports, %s sync jobs, %s orphaned avatars (postDays=%s, "
        "logDays=%s, payloadDays=%s, syncJobDays=%s)",
        deleted_posts,
        deleted_logs,
        deleted_payloads,
        deleted_reports,
        deleted_sync_jobs,
        deleted_photos,
        post_days,
        log_days,
        payload_days,
        app_settings.SYNC_JOB_RETENTION_DAYS,
    )
    return {
        "deletedPosts": deleted_posts,
        "deletedLogs": deleted_logs,
        "deletedPayloads": deleted_payloads,
        "deletedReports": deleted_reports,
        "deletedSyncJobs": deleted_sync_jobs,
        "deletedPhotos": deleted_photos,
    }
