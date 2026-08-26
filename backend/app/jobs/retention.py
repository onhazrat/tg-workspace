"""Server-side data retention cleanup (replaces App.tsx 6h interval).

## Four windows, because there are four kinds of row (ticket 20)

Retention used to run entirely on one blob of settings any account could write,
narrowed by `user_id == operator OR IS NULL` — a filter that looked like
scoping and was not: it protected nobody's rows once a second account existed,
and `postRetentionDays` was a live way for any account to destroy every
account's Posts on the next sweep. Ticket 18 gated the write. This job is the
other half, and it splits by what the rows *are*:

* **The corpus** — Posts and the embeddings, translations and sync state keyed
  to them — is shared: one scrape serves every follower. It runs on the
  deployment's `postRetentionDays` with **no owner filter at all**, because
  there is no owner to filter on. `Post.user_id` is a "who scraped this first"
  stamp that ticket 22 drops, and filtering on it deleted the first follower's
  rows while leaving the second follower's identical ones behind.
* **Personal logs** — publish, LLM and embedding rows stamped with an account's
  id — run on **that account's** `logRetentionDays`. Accounts that chose the
  same window are swept together, so the query count does not grow with
  signups.
* **Shared and ownerless logs** — the sync family (Channel telemetry since
  ticket 19), the network family (proxy behaviour, Admin-only), and any row of
  the three personal families whose `user_id` is NULL because a background job
  wrote it — run on the deployment's `sharedLogRetentionDays`. Without this
  window those rows are reachable by no window at all.
* **Discover reports** are artifacts an account produced, so each account's own
  age and count caps apply to its own reports. Applying one account's count cap
  across the whole table is how the newest report of every *other* account got
  pruned by somebody generating a burst of their own.

Channel collection and the asset sweeps stay deployment-wide and are not
windows at all: a Channel is collected when nobody follows it, and an orphaned
avatar is garbage by definition rather than by age.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, cast

from sqlalchemy import delete as sa_delete
from sqlmodel import Session, col, func, select

# Aliased for symmetry with the rest of `app/jobs`, where a local `settings`
# holding stored values would otherwise shadow the process settings object.
from app.core.config import settings as app_settings
from app.jobs.settings import (
    load_media_settings,
    load_retention_policy,
    load_retention_prefs_by_user,
)
from app.models_tg import (
    Channel,
    DiscoverReport,
    Post,
    PostEmbedding,
    PostTranslation,
    utc_now,
)
from app.services.channel_photos import (
    delete_cached_photo,
    photo_stem,
    prune_orphaned_photos,
)
from app.services.channels import collect_unfollowed_channel
from app.services.follows import channel_ids_without_follows, follows_backfilled
from app.services.logs import (
    LOG_MODELS,
    PERSONAL_LOG_TYPES,
    SHARED_LOG_TYPES,
    LogSweep,
    delete_logs_before,
    delete_owned_logs_before,
    delete_unowned_logs_before,
    expire_sync_payloads_stmt,
)
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

#: Channels collected per retention pass. Each one is a full corpus delete and
#: nothing waits on the queue draining, so the next hourly run takes the rest.
COLLECT_LIMIT = 100


def _cutoff_ms(days: int) -> int:
    """The epoch-millisecond timestamp `days` before now."""
    return int(utc_now().timestamp() * 1000) - days * 24 * 60 * 60 * 1000


def _ordered(log_types: frozenset[str]) -> list[str]:
    """`log_types` in `LOG_MODELS` declaration order.

    A frozenset iterates in whatever order the hashes fall, which would make
    the sweep's per-type commits — and so the log line and the test fixtures —
    reorder between runs for no reason. Declaration order costs nothing.
    """
    return [log_type for log_type in LOG_MODELS if log_type in log_types]


def _prune_discover_reports(
    session: Session, *, user_id: uuid.UUID, max_days: int, max_count: int
) -> int:
    """Trim one account's saved Discover reports by age, then by count.

    Reports are the one table that grows per user action with no natural bound:
    each Generate stores its whole candidate list, single-reference tail
    included, as a JSON blob. Nothing else prunes them.

    **Per account, both caps, since ticket 20.** Applied across the whole table
    the count cap was the sharper edge of the two: one account generating fifty
    reports in an afternoon pushed every other account's newest report past the
    offset and deleted it, and the age window did the same on a shorter horizon.
    A report is an artifact its account produced (ticket 17), so its account's
    caps are the ones that decide.

    Both caps apply and 0 disables either, matching the post and log windows. The
    count cap is what actually bounds size — an age window alone lets a burst of
    reports generated in one afternoon survive in full.

    There is deliberately no floor: if the policy says the newest report goes, it
    goes, and Discover shows its empty state prompting a Generate. Setting the
    values to 0 is how you opt out, rather than the job second-guessing them.

    **Per account rather than grouped, unlike the log sweep**, which costs at
    most two indexed statements per account per hour. The log families are
    grouped because `delete_owned_logs_before` already took a list of owners;
    grouping the count cap here would mean ranking with `row_number() OVER
    (PARTITION BY user_id)`, which is real complexity bought against a cost
    nobody has measured. The trigger for changing that is account count, not
    taste: at a few hundred accounts this is still noise, and at a few thousand
    the age half groups exactly like the logs do and the count half needs the
    window function.

    **A report with no owner is reached by nothing here**, by construction —
    every cap is somebody's. The ticket 20 migration adopts the legacy ones
    once, and every report written since ticket 17 carries an owner, so the
    only way to hold an unreachable report is to have migrated a database that
    had saved reports and no account at all.
    """
    deleted = 0
    mine = col(DiscoverReport.user_id) == user_id

    if max_days > 0:
        result = session.execute(
            sa_delete(DiscoverReport).where(
                mine, col(DiscoverReport.timestamp) < _cutoff_ms(max_days)
            )
        )
        session.commit()
        deleted += cast(Any, result).rowcount or 0

    if max_count > 0:
        # Ids of everything past this account's newest N, then one bulk delete.
        # The blob column is never loaded — only the ids are selected.
        stale = session.exec(
            select(DiscoverReport.id)
            .where(mine)
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


def _collect_unfollowed_channels(session: Session) -> tuple[int, int]:
    """Reclaim Channels nobody follows. Returns (channels, posts) deleted.

    The deferred half of the delete that ticket 05 took out of the removal
    path. A Channel at zero followers is unreachable — no account lists it, no
    scheduler holds a deadline for it — so there is nothing left to protect,
    and the corpus underneath it is bytes nobody asked for.

    There is deliberately **no grace window**. Unfollowing is an explicit
    action on your own list, and a window would need a setting, a timestamp
    column, and an answer to what re-following inside it means. Re-following
    before this job's next pass already keeps everything, because the check is
    made at collection time rather than recorded at unfollow time.

    Committed per channel, not per run: a busy channel's corpus is a large
    delete, and batching the lot into one transaction would hold it open across
    every one of them — the `idle in transaction` shape that pinned the xmin
    horizon in `run_auto_sync`.

    **Refuses to run until the follow backfill has recorded completion.** An
    empty `tg_channel_follows` reads identically whether nobody follows these
    channels or nobody has written the rows yet, and the two have opposite
    consequences. This job fires ~60s after every boot, so on a database whose
    backfill has not run — the native dev flow never invokes `prestart.sh`, and
    a restored pre-ticket-04 backup has no marker either — the unguarded
    version would delete every channel and every post a minute after startup.
    The operator's retention windows are no defence: collection ignores them,
    so `postRetentionDays: 0` would not have saved that database.

    `COLLECT_LIMIT` bounds one pass because each channel's corpus delete is
    expensive and there is no deadline on draining the queue: the next hourly
    run takes the rest.
    """
    if not follows_backfilled(session):
        logger.warning(
            "Retention: skipping unfollowed-channel collection — the follow "
            "backfill has not recorded completion, so an absent follow does "
            "not yet mean nobody follows the channel. Run "
            "scripts/backfill_channel_follows.py."
        )
        return 0, 0

    channel_ids = channel_ids_without_follows(session)[:COLLECT_LIMIT]
    if not channel_ids:
        return 0, 0

    collected = 0
    posts = 0
    for channel_id in channel_ids:
        posts += collect_unfollowed_channel(session, channel_id)
        session.commit()
        # After the commit, not inside it: a rollback would otherwise leave the
        # Channel alive with its cached avatar already gone from disk.
        delete_cached_photo(channel_id)
        collected += 1

    if collected:
        touch_sync(session, "channels", commit=False)
        touch_sync(session, "posts")
    return collected, posts


def _sweep_logs(
    session: Session,
    *,
    shared_days: int,
    prefs_by_user: dict[uuid.UUID, dict[str, Any]],
) -> tuple[int, int]:
    """Delete expired log rows, each family on the window that decides for it.

    Returns (log rows, sync payload rows). The payload count comes back
    separately because the shared sweep takes payloads with their parent — a
    payload whose log row is gone is unreachable, which is the stranding ticket
    19's review caught — and `run_retention_cleanup` reports the two numbers
    apart. Dropping it on the floor here is what made `deletedPayloads`
    under-report everything the log window removed.

    Logs first in the run: they are the heaviest tables (tg_sync_logs
    full_response is ~17KB/row, up to 3MB) and the cheapest to clear, so they go
    before the slower per-post work in case the latter is interrupted.

    Two passes. The deployment's window takes the families no account owns and
    the ownerless rows of the ones that are otherwise personal. Then each
    distinct personal window takes the rows of every account that chose it —
    grouped, so a deployment with fifty accounts on the default runs one DELETE
    per log type rather than fifty, and a single-operator deployment runs
    exactly the query it ran before ticket 20.
    """
    deleted_logs = 0
    deleted_payloads = 0
    swept: set[str] = set()

    def record(sweep: LogSweep) -> None:
        nonlocal deleted_logs, deleted_payloads
        deleted_payloads += sweep.payloads
        for log_type, count in sweep.counts.items():
            if count:
                deleted_logs += count
                swept.add(LOG_MODELS[log_type][1])

    if shared_days > 0:
        cutoff = _cutoff_ms(shared_days)
        record(
            delete_logs_before(session, cutoff, log_types=_ordered(SHARED_LOG_TYPES))
        )
        # The same window reaches the rows of the *personal* families that no
        # account owns. Nothing else can: a per-account sweep filters on an id
        # these rows do not carry, so before ticket 20 they were deleted only by
        # the operator's own window happening to include `user_id IS NULL`.
        record(
            delete_unowned_logs_before(
                session, cutoff, log_types=_ordered(PERSONAL_LOG_TYPES)
            )
        )

    owners_by_window: dict[int, list[uuid.UUID]] = {}
    for user_id, prefs in prefs_by_user.items():
        days = int(prefs.get("logRetentionDays") or 0)
        if days > 0:
            owners_by_window.setdefault(days, []).append(user_id)

    for days in sorted(owners_by_window):
        record(
            delete_owned_logs_before(
                session,
                _cutoff_ms(days),
                log_types=_ordered(PERSONAL_LOG_TYPES),
                user_ids=owners_by_window[days],
            )
        )

    for resource in sorted(swept):
        touch_sync(session, resource)
    return deleted_logs, deleted_payloads


def run_retention_cleanup(session: Session) -> dict[str, int]:
    policy = load_retention_policy(session)
    post_days = int(policy.get("postRetentionDays") or 0)
    shared_log_days = int(policy.get("sharedLogRetentionDays") or 0)
    payload_days = int(policy.get("payloadRetentionDays") or 0)
    prefs_by_user = load_retention_prefs_by_user(session)

    deleted_posts = 0

    deleted_logs, deleted_payloads = _sweep_logs(
        session, shared_days=shared_log_days, prefs_by_user=prefs_by_user
    )

    # Payloads expire on their own, shorter horizon: the bodies are the bulk of
    # a sync log, so discarding them early keeps a long audit trail cheap.
    # Deployment policy like the log rows they hang off — ticket 19 made the
    # parent Channel telemetry, and a body cannot be more personal than the row
    # it belongs to.
    if payload_days > 0:
        payload_result = session.execute(
            expire_sync_payloads_stmt(_cutoff_ms(payload_days))
        )
        session.commit()
        expired = cast(Any, payload_result).rowcount or 0
        if expired:
            deleted_payloads += expired
            touch_sync(session, "sync_logs")

    if post_days > 0:
        # No owner filter. The corpus is shared — one scrape serves every
        # follower — so there is no account whose Posts these are, and the
        # `user_id` the sweep used to narrow on is the stamp of whoever
        # scraped the row first, which ticket 22 drops.
        cutoff = _cutoff_ms(post_days)
        affected_channels: set[str] = set()
        # Page through the backlog: select a bounded batch, delete it and its
        # dependents in bulk, commit, repeat. Memory stays flat regardless of
        # how far behind retention is.
        while True:
            batch_stmt = select(Post).where(
                col(Post.timestamp) < cutoff,
                col(Post.is_anchor) == False,  # noqa: E712
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

    # After the post sweep, before the avatar sweep: collecting a channel
    # removes its posts, and the avatar sweep below builds its keep-set from the
    # surviving channel ids — running it first would leave the collected
    # channels' avatars on disk for another whole cycle.
    deleted_channels, collected_posts = _collect_unfollowed_channels(session)
    deleted_posts += collected_posts

    # Per account, on that account's caps. A report belongs to whoever
    # generated it, so one person's count cap must not decide how many reports
    # anybody else keeps.
    deleted_reports = 0
    for user_id, prefs in prefs_by_user.items():
        deleted_reports += _prune_discover_reports(
            session,
            user_id=user_id,
            max_days=int(prefs.get("reportRetentionDays") or 0),
            max_count=int(prefs.get("reportRetentionMax") or 0),
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
        "%s reports, %s sync jobs, %s unfollowed channels, %s orphaned avatars "
        "(postDays=%s, sharedLogDays=%s, payloadDays=%s, syncJobDays=%s, "
        "accounts=%s)",
        deleted_posts,
        deleted_logs,
        deleted_payloads,
        deleted_reports,
        deleted_sync_jobs,
        deleted_channels,
        deleted_photos,
        post_days,
        shared_log_days,
        payload_days,
        app_settings.SYNC_JOB_RETENTION_DAYS,
        len(prefs_by_user),
    )
    return {
        "deletedPosts": deleted_posts,
        "deletedLogs": deleted_logs,
        "deletedPayloads": deleted_payloads,
        "deletedReports": deleted_reports,
        "deletedSyncJobs": deleted_sync_jobs,
        "deletedChannels": deleted_channels,
        "deletedPhotos": deleted_photos,
    }
