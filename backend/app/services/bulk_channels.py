"""Bulk channel reset + sync (backward-sync era)."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field

from sqlmodel import Session, col, delete, func, select

from app.models_tg import Channel, Post, PostEmbedding, PostTranslation, utc_now
from app.services.channel_setting_groups import channel_allows_reset, load_groups_by_id
from app.services.follows import FollowedChannel, followed_channels_for
from app.services.post_sync_state import clear_channel_sync_state
from app.services.quota import QuotaCeilingReached
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


def is_auto_followed_channel(pair: FollowedChannel) -> bool:
    """Whether this follow was created by auto-follow rather than by hand.

    Reads `discovered_via` off the follow since ticket 22 dropped the Channel's
    copy. That is also the more honest question: how *you* came to follow a
    handle is yours, and on the Channel it reported a channel as auto-followed
    for everybody because one account happened to reach it that way.

    Takes the `(Channel, follow)` pair rather than the follow alone so this
    module never names `ChannelFollow` — `test_channel_creation_paths.py` reads
    any mention of that identifier outside the aggregate as a second writer, and
    `FollowedChannel` is the alias declared for exactly this.
    """
    return pair[1].discovered_via is not None


def select_bulk_channels(
    session: Session,
    *,
    operator_id: uuid.UUID,
    channel_ids: list[str] | None = None,
    auto_follow_only: bool = False,
    limit: int | None = None,
) -> list[FollowedChannel]:
    """The Channels a bulk operation should act on, each with its own follow.

    Returns pairs rather than bare Channels since ticket 22: both filters below
    and both callers' group lookups read fields that now live on the follow, and
    re-fetching it per channel afterwards would be a query per row.
    """
    pairs = followed_channels_for(session, user_id=operator_id)
    if channel_ids:
        wanted = set(channel_ids)
        pairs = [pair for pair in pairs if pair[0].id in wanted]
    if auto_follow_only:
        pairs = [pair for pair in pairs if is_auto_followed_channel(pair)]
    if limit is not None and limit > 0:
        pairs = pairs[:limit]
    return pairs


async def bulk_reresolve_start_ids(
    session: Session,
    *,
    operator_id: uuid.UUID,
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
    # The deletes below were already bulk; only the count was not. Loading
    # every post just to call len() on it defeated that, so count in SQL.
    count = (
        session.exec(
            select(func.count())
            .select_from(Post)
            .where(col(Post.channel_name) == channel_name)
        ).one()
        or 0
    )
    if not count:
        return 0
    session.exec(
        delete(PostEmbedding).where(col(PostEmbedding.channel_name) == channel_name)
    )
    session.exec(
        delete(PostTranslation).where(col(PostTranslation.channel_name) == channel_name)
    )
    session.exec(delete(Post).where(col(Post.channel_name) == channel_name))
    return int(count)


def _reset_channel_coverage_fields(channel: Channel) -> None:
    channel.anchor_post_id = None
    channel.oldest_stored_post_timestamp = None
    channel.history_complete_to_cutoff = True
    channel.history_reached_channel_start = False
    channel.updated_at = utc_now()


async def bulk_reset_and_queue_sync(
    session: Session,
    *,
    operator_id: uuid.UUID,
    channel_ids: list[str] | None = None,
    auto_follow_only: bool = False,
    source: str = "Bulk Reset & Sync",
) -> BulkResetSyncResult:
    from app.jobs.sync_queue import enqueue_sync_job
    from app.services.scraper_jobs import create_job

    channels = select_bulk_channels(
        session,
        operator_id=operator_id,
        channel_ids=channel_ids,
        auto_follow_only=auto_follow_only,
    )
    result = BulkResetSyncResult()
    entries: list[tuple[str, str]] = []
    groups_by_id = load_groups_by_id(session)
    is_bulk = channel_ids is None or len(channel_ids) != 1

    for channel, follow in channels:
        # The follow names the group since ticket 22, so a reset is judged
        # against this account's own policy for the channel.
        group = (
            groups_by_id.get(follow.setting_group_id)
            if follow.setting_group_id is not None
            else None
        )
        if group is None or not channel_allows_reset(group, bulk=is_bulk):
            result.errors.append(
                {
                    "channelId": channel.id,
                    "channelName": channel.name,
                    "error": "Reset & Sync not allowed for this channel's setting group",
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
            user_id=str(operator_id),
            sync_mode="bulk" if is_bulk else "individual",
        )
        result.job_id = job.job_id
        try:
            await enqueue_sync_job(job, operator_id)
        except QuotaCeilingReached:
            # The reset half of "reset and sync" has already committed, so this
            # cannot raise past here without reporting a whole failed operation
            # for a sync that is merely postponed. `enqueue_sync_job` marked the
            # job terminal with the reason, and `result.job_id` still names it,
            # so the caller's job view carries the answer.
            logger.info(
                "Bulk channels: %s is at its request ceiling; sync not queued",
                operator_id,
            )

    return result
