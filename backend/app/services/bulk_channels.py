"""Bulk channel reset + sync (backward-sync era)."""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlmodel import Session, col, delete, select

from app.models_tg import Channel, Post, PostEmbedding, PostTranslation
from app.services.operator import select_operator_channels
from app.services.post_sync_state import clear_channel_sync_state
from app.services.sync_meta import touch_sync

logger = logging.getLogger(__name__)


@dataclass
class BulkReresolveResult:
    """Deprecated — start_id no longer drives sync."""

    updated: int = 0
    skipped: int = 0
    would_update: int = 0
    errors: list[dict[str, str]] = field(default_factory=list)
    deprecated: bool = True
    message: str = "bulk_reresolve_start_ids is deprecated; use bulk_reset_sync for full re-backfill."


@dataclass
class BulkResetSyncResult:
    channels_reset: int = 0
    posts_deleted: int = 0
    job_id: str | None = None
    errors: list[dict[str, str]] = field(default_factory=list)


def is_auto_followed_channel(channel: Channel) -> bool:
    """Channels added via auto-follow carry a non-null discovered_via payload."""
    return channel.discovered_via is not None


def select_bulk_channels(
    session: Session,
    *,
    operator_id: uuid.UUID | None,
    channel_ids: list[str] | None = None,
    auto_follow_only: bool = False,
    limit: int | None = None,
) -> list[Channel]:
    channels = select_operator_channels(session, operator_id=operator_id)
    if channel_ids:
        wanted = set(channel_ids)
        channels = [ch for ch in channels if ch.id in wanted]
    if auto_follow_only:
        channels = [ch for ch in channels if is_auto_followed_channel(ch)]
    if limit is not None and limit > 0:
        channels = channels[:limit]
    return channels


async def bulk_reresolve_start_ids(
    session: Session,
    *,
    operator_id: uuid.UUID | None,
    dry_run: bool = False,
    limit: int | None = None,
    channel_ids: list[str] | None = None,
    auto_follow_only: bool = False,
) -> BulkReresolveResult:
    """Deprecated — retained for API compatibility; does not modify channels."""
    _ = dry_run
    channels = select_bulk_channels(
        session,
        operator_id=operator_id,
        channel_ids=channel_ids,
        auto_follow_only=auto_follow_only,
        limit=limit,
    )
    result = BulkReresolveResult(skipped=len(channels))
    logger.warning(
        "bulk_reresolve_start_ids called for %s channel(s); no-op (deprecated)",
        len(channels),
    )
    return result


def _clear_channel_posts(session: Session, channel_name: str) -> int:
    posts = list(
        session.exec(select(Post).where(Post.channel_name == channel_name)).all()
    )
    if not posts:
        return 0
    session.exec(
        delete(PostEmbedding).where(col(PostEmbedding.channel_name) == channel_name)
    )
    session.exec(
        delete(PostTranslation).where(col(PostTranslation.channel_name) == channel_name)
    )
    session.exec(delete(Post).where(col(Post.channel_name) == channel_name))
    return len(posts)


def _reset_channel_coverage_fields(channel: Channel) -> None:
    channel.anchor_post_id = None
    channel.oldest_stored_post_timestamp = None
    channel.history_complete_to_cutoff = True
    channel.updated_at = datetime.utcnow()


async def bulk_reset_and_queue_sync(
    session: Session,
    *,
    operator_id: uuid.UUID | None,
    channel_ids: list[str] | None = None,
    auto_follow_only: bool = False,
    source: str = "Bulk Reset & Sync",
) -> BulkResetSyncResult:
    from app.services.scraper_jobs import create_job
    from app.services.sync_orchestrator import run_sync_job

    channels = select_bulk_channels(
        session,
        operator_id=operator_id,
        channel_ids=channel_ids,
        auto_follow_only=auto_follow_only,
    )
    result = BulkResetSyncResult()
    entries: list[tuple[str, str]] = []

    for channel in channels:
        if channel.is_frozen:
            result.errors.append(
                {
                    "channelId": channel.id,
                    "channelName": channel.name,
                    "error": "Channel is frozen",
                }
            )
            continue
        try:
            deleted = _clear_channel_posts(session, channel.name)
            clear_channel_sync_state(session, channel.name)
            _reset_channel_coverage_fields(channel)
            result.posts_deleted += deleted
            session.add(channel)
            entries.append((channel.id, channel.name))
            result.channels_reset += 1
        except Exception as exc:  # noqa: BLE001
            session.rollback()
            result.errors.append(
                {
                    "channelId": channel.id,
                    "channelName": channel.name,
                    "error": str(exc),
                }
            )

    if entries:
        session.commit()
        touch_sync(session, "channels")
        touch_sync(session, "posts")

        job = await create_job(
            channel_entries=entries,
            source=source,
            user_id=str(operator_id) if operator_id else None,
        )
        result.job_id = job.job_id
        asyncio.create_task(run_sync_job(job, operator_id))

    return result
