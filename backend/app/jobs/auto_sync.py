"""Auto-sync stale channels (replaces App.tsx 60s client interval)."""

from __future__ import annotations

import logging
import time
import uuid
from types import SimpleNamespace
from typing import Any, NamedTuple

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.jobs.settings import load_sync_settings, save_sync_settings
from app.jobs.sync_queue import enqueue_sync_job
from app.models_tg import Channel
from app.services.channel_setting_groups import load_groups_by_id
from app.services.channels import compute_channel_stats_batch
from app.services.follows import (
    FollowedChannel,
    accounts_with_follows,
    count_followed_channels,
    followed_channels_for,
    schedule_group_id,
)
from app.services.scraper_jobs import SyncJobState, create_job, has_active_sync_job
from app.services.sync_schedule import due_reason, is_channel_due, needs_dynamic_stats

logger = logging.getLogger(__name__)

CHECK_SOURCE = "Auto Sync (scheduler)"


def _update_sync_state(session: Session, updates: dict[str, Any]) -> None:
    """Persist the scheduler's own counters, and nothing else.

    This used to read the whole `sync` blob, apply `updates` to the copy, and
    write the copy back — so every failure the scheduler counted also rewrote
    whatever preferences the row happened to hold. Ticket 06 put those counters
    in their own global row, so passing only the changed fields is now both
    possible and the whole point: `save_sync_settings` routes each one and
    touches no section this call did not name.
    """
    save_sync_settings(session, updates)


def _schedule_view(
    channel: Channel, group: Any, stats: dict[str, Any] | None
) -> SimpleNamespace:
    """The subset of a channel `sync_schedule` actually reads.

    `stats` is `None` on the first pass, before we know whether this channel's
    decision depends on them — see `_stats_for_scheduling`. The stub values are
    the ones that make `_is_dynamic_eligible` false, so a channel that the
    predicate clears is decided identically either way.
    """
    return SimpleNamespace(
        is_frozen=group.is_frozen,
        regular_sync_enabled=group.regular_sync_enabled,
        dynamic_sync_enabled=group.dynamic_sync_enabled,
        next_regular_sync_at=channel.next_regular_sync_at,
        next_dynamic_sync_at=channel.next_dynamic_sync_at,
        has_posts=int((stats or {}).get("count") or 0) > 0,
        velocity=float((stats or {}).get("velocity") or 0.0),
    )


class _OwnerPlan(NamedTuple):
    """What one account's tick decided, before any of it is enqueued.

    A record rather than four parallel dicts, because the planning loop now runs
    once per account and the four values have to stay together per account — the
    shape where a stray `[owner]` lookup silently reads another account's due
    reasons.
    """

    owner_id: uuid.UUID
    entries: list[tuple[str, str]]
    reasons: dict[str, str]
    due_count: int
    partial_count: int


def _stats_for_scheduling(
    session: Session,
    channels: list[Channel],
    groups_by_id: dict[str, Any],
    now_ms: int,
    pairs: list[FollowedChannel],
) -> dict[str, dict[str, Any]]:
    """Post stats for the channels whose due-ness can actually depend on them.

    This used to be `compute_channel_stats_batch(session, every_channel_name)`,
    which on staging meant `count(*)` plus `min`/`max` over 4.54M posts every 60
    seconds — 69 minutes of database time and 76M block reads per 10 hours — for
    two values, of which `min_id`/`max_id` were discarded outright. 1,756 of the
    2,077 channels had a dynamic deadline still in the future, so their answer
    was already fixed; six were live.

    `needs_dynamic_stats` decides, not this function: the condition belongs next
    to the rule it mirrors, in `sync_schedule`.

    `pairs` carries each Channel's follow so the narrowing asks the *follower's*
    setting group, matching the planning loop. Without it this would decide
    which channels need stats from the Channel's shared group while the loop
    decided due-ness from the follow's — two different groups, so the narrowing
    would withhold stats from exactly the channels whose answer depends on them
    and every dynamic sync would quietly stop firing.

    **Required, with no default, since ticket 22.** It was optional, falling
    back to `Channel.setting_group_id` — a column this ticket dropped. Leaving
    the parameter optional would have turned that fallback into "no group at
    all", so a caller that forgot it would silently flag nothing and every
    dynamic sync would stop firing, which is the exact failure the paragraph
    above describes. Its only caller already passes it.
    """
    group_ids: dict[str, str | None] = {
        channel.id: schedule_group_id(follow) for channel, follow in pairs
    }
    wanted = [
        ch.name
        for ch in channels
        if (group_id := group_ids.get(ch.id)) is not None
        and (group := groups_by_id.get(group_id)) is not None
        and needs_dynamic_stats(_schedule_view(ch, group, None), now_ms)
    ]
    if not wanted:
        return {}
    return compute_channel_stats_batch(session, wanted)


async def run_auto_sync() -> dict[str, Any]:
    """Trigger sync for channels stale beyond configured interval.

    The planning session is closed **before** the job runs. It used to stay open
    across `await run_sync_job(...)`, so a transaction sat `idle in transaction`
    for the whole sync — minutes — pinning the xmin horizon the entire time.
    Autovacuum kept running and kept reclaiming nothing: measured on staging,
    `tg_sync_meta` held **10 live rows and 4,743 dead ones** after 1,062
    autovacuums, and `tg_channels` 2,077 live against 4,498 dead in 19 MB. That
    bloat is what made single-row updates by primary key stall for whole seconds
    with no I/O at all (`UPDATE tg_channels SET subscribers`: min 0 ms, max
    21,361 ms, ~112 blocks read across 778 calls).

    So: read what the decision needs, extract it as plain values, close the
    session, then sync. Nothing below the `with` block may hold an ORM object —
    `entries` and `due_reason_by_id` are deliberately plain tuples and strings.
    """
    now = int(time.time() * 1000)
    plans: list[_OwnerPlan] = []
    checked = 0
    partial_candidate_count = 0

    with Session(engine) as session:
        sync_cfg = load_sync_settings(session)
        pause_until = sync_cfg.get("autoSyncPauseUntil")
        if pause_until and now < int(pause_until):
            return {"skipped": True, "reason": "paused", "pauseUntil": pause_until}
        if pause_until and now >= int(pause_until):
            _update_sync_state(
                session, {"autoSyncPauseUntil": None, "consecutiveFailures": 0}
            )

        if has_active_sync_job():
            return {"skipped": True, "reason": "sync_job_active"}

        owners = accounts_with_follows(session)
        if not owners:
            # Nobody follows anything, so there is nothing to sync and no
            # account to attribute a job to. Distinct from "no channels are
            # due", which is the ordinary quiet tick below.
            return {"skipped": True, "reason": "no_followed_channels"}

        groups_by_id = load_groups_by_id(session)
        due_by_owner: dict[uuid.UUID, list[Channel]] = {}
        reason_by_owner: dict[uuid.UUID, dict[str, str]] = {}
        partial_candidates: list[tuple[uuid.UUID, Channel]] = []

        for owner_id in owners:
            pairs = followed_channels_for(session, user_id=owner_id)
            checked += len(pairs)
            owner_due: list[Channel] = []
            owner_reasons: dict[str, str] = {}

            # Stats are per Channel, not per follower, so they are fetched once
            # for this owner's set. Two accounts following the same Channel each
            # pay for it, which is the cost of asking the question per owner —
            # and `needs_dynamic_stats` still narrows it to the handful whose
            # answer can actually turn on the numbers.
            owner_channels = [channel for channel, _follow in pairs]
            stats_by_channel = _stats_for_scheduling(
                session, owner_channels, groups_by_id, now, pairs
            )

            for channel, follow in pairs:
                group_id = schedule_group_id(follow)
                group = groups_by_id.get(group_id) if group_id is not None else None
                if group is None:
                    continue
                schedule_view = _schedule_view(
                    channel, group, stats_by_channel.get(channel.name)
                )
                if is_channel_due(schedule_view, now):
                    reason = due_reason(schedule_view, now)
                    if reason is not None:
                        owner_due.append(channel)
                        owner_reasons[channel.id] = reason
                        continue
                if not group.is_frozen and not channel.history_complete_to_cutoff:
                    partial_candidates.append((owner_id, channel))

            due_by_owner[owner_id] = owner_due
            reason_by_owner[owner_id] = owner_reasons

        partial_candidate_count = len(partial_candidates)
        partial_by_owner: dict[uuid.UUID, list[Channel]] = {}
        if partial_candidates:
            # One cursor for the whole deployment, over the union of every
            # owner's candidates. Per-owner cursors would be the obvious move
            # and would change what `autoSyncPartialCursor` means, splitting one
            # setting into N pieces of scheduler state nothing reads back — so
            # the rotation stays global and only the *attribution* is per owner.
            # Sorted by `(channel id, owner)` so the order is stable across
            # ticks, which is what makes the rotation a rotation.
            partial_sorted = sorted(
                partial_candidates, key=lambda pair: (pair[1].id, str(pair[0]))
            )
            cursor = int(sync_cfg.get("autoSyncPartialCursor") or 0)
            batch_size = max(1, int(sync_cfg.get("autoSyncPartialBatchSize") or 1))
            taken = 0
            for i in range(min(batch_size, len(partial_sorted))):
                idx = (cursor + i) % len(partial_sorted)
                owner_id, channel = partial_sorted[idx]
                partial_by_owner.setdefault(owner_id, []).append(channel)
                taken += 1
            _update_sync_state(session, {"autoSyncPartialCursor": cursor + taken})

        for owner_id in owners:
            to_sync: list[Channel] = []
            seen_ids: set[str] = set()
            for channel in due_by_owner.get(owner_id, []) + partial_by_owner.get(
                owner_id, []
            ):
                if channel.id in seen_ids:
                    continue
                seen_ids.add(channel.id)
                to_sync.append(channel)
            if not to_sync:
                continue
            plans.append(
                _OwnerPlan(
                    owner_id=owner_id,
                    entries=[(ch.id, ch.name) for ch in to_sync],
                    reasons=reason_by_owner.get(owner_id, {}),
                    due_count=len(due_by_owner.get(owner_id, [])),
                    partial_count=len(partial_by_owner.get(owner_id, [])),
                )
            )

    if not plans:
        return {
            "skipped": True,
            "reason": "no_due_channels",
            "checked": checked,
            "partialCandidates": partial_candidate_count,
        }

    # Ticket 10: enqueued, one message per Channel, and drained by whichever
    # process is running the worker — which after that ticket is never the API
    # process. `run_auto_sync` therefore returns as soon as the messages are on
    # the lane, and the counters below it moved to `record_auto_sync_outcome`,
    # because there is no longer a point in this function where the sync is
    # finished.
    #
    # One job per owner (ticket 21). A Channel two accounts both follow is
    # enqueued twice and scraped once: ticket 11's per-Channel claim coalesces
    # the second onto the first, which reports the first one's outcome and is
    # not charged for it.
    job_ids: list[str] = []
    statuses: list[str] = []
    for plan in plans:
        job = await create_job(
            channel_entries=plan.entries,
            source=CHECK_SOURCE,
            user_id=str(plan.owner_id),
            channel_meta_by_id={
                cid: {"dueReason": plan.reasons.get(cid)} for cid, _ in plan.entries
            },
        )
        await enqueue_sync_job(job, plan.owner_id)
        job_ids.append(job.job_id)
        statuses.append(job.status)

    all_reasons = [r for plan in plans for r in plan.reasons.values()]
    return {
        # `jobId` stays singular and names the first job, because the Jobs panel
        # and `test_scheduler_jobs.py` both read it and a tick still produces
        # one job on the single-account deployment this ships to. `jobIds` is
        # the honest answer once there are two accounts.
        "jobId": job_ids[0],
        "jobIds": job_ids,
        "owners": len(plans),
        "channels": sum(len(plan.entries) for plan in plans),
        "checked": checked,
        "dueChannels": sum(plan.due_count for plan in plans),
        "partialChannels": sum(plan.partial_count for plan in plans),
        "dueRegular": sum(1 for reason in all_reasons if reason == "regular"),
        "dueDynamic": sum(1 for reason in all_reasons if reason == "dynamic"),
        "dueBoth": sum(1 for reason in all_reasons if reason == "both"),
        "status": statuses[0],
    }


def _schedulable_channel_count(session: Session) -> int:
    """How many Channels a tick could have considered, across every account.

    `run_auto_sync` used to have this in hand as `len(channels)` and pass it
    straight into the threshold. It is recomputed here rather than smuggled
    through the job row because a job carries Channels, not the size of the set
    they were chosen from, and inventing a place to stash one number would
    outlive the reason for it. One `count(*)` per finished auto-sync job — at
    most once a tick — against the per-tick cost this ticket's predecessors
    spent months removing, is not the expensive part of anything.

    Ticket 21 replaced the `Channel.user_id == operator OR NULL` filter with
    "distinct Channels anybody follows". The counter this feeds is the
    consecutive-failure threshold, which is **global scheduler state** — one
    pause for the whole deployment — so the denominator has to be the whole
    deployment's schedulable set, not one account's. Counting only one owner's
    channels would pause every account's auto-sync after that owner's share of
    failures.

    Distinct Channels rather than follows: two accounts following one dead
    handle is one Channel that can fail, and counting it twice would raise the
    threshold for a deployment that did not get bigger.
    """
    return count_followed_channels(session)


def record_auto_sync_outcome(job: SyncJobState) -> None:
    """Fold a finished auto-sync job into the scheduler's failure counters.

    This ran inline in `run_auto_sync` while that function awaited the whole
    sync. Ticket 10 enqueues instead, so the job finishes somewhere else and
    later — `app/jobs/sync_queue.py` calls this from `_finalize_if_complete`
    when the job it just finished came from the scheduler.

    The consecutive-failure counter and the pause it can trigger are global
    scheduler state (`sync_runtime`, ticket 06), which is why this writes only
    the fields it names: the read-modify-write of the whole `sync` blob is
    exactly what ticket 06 split apart, and the scheduler bumping a counter must
    not write back a preference some browser last read.
    """
    failures = [ch for ch in job.channels.values() if ch.status == "failed"]
    successes = [ch for ch in job.channels.values() if ch.status == "success"]
    if not failures and not successes:
        return

    with Session(engine) as session:
        sync_cfg = load_sync_settings(session)
        if failures:
            prev_failures = int(sync_cfg.get("consecutiveFailures") or 0)
            next_failures = prev_failures + len(failures)
            updates: dict[str, Any] = {"consecutiveFailures": next_failures}
            threshold = max(
                settings.AUTO_SYNC_FAILURE_THRESHOLD_MIN,
                _schedulable_channel_count(session),
            )
            if next_failures >= threshold:
                updates["autoSyncPauseUntil"] = (
                    int(time.time() * 1000) + settings.AUTO_SYNC_PAUSE_DURATION_MS
                )
                logger.warning(
                    "Auto-sync paused for 10 minutes after %s consecutive failures",
                    next_failures,
                )
            _update_sync_state(session, updates)
        elif successes:
            _update_sync_state(session, {"consecutiveFailures": 0})
