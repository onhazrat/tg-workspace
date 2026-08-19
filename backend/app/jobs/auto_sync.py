"""Auto-sync stale channels (replaces App.tsx 60s client interval)."""

from __future__ import annotations

import logging
import time
from types import SimpleNamespace
from typing import Any

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.jobs.settings import load_sync_settings, save_setting
from app.models_tg import Channel
from app.services.channel_setting_groups import load_groups_by_id
from app.services.channels import compute_channel_stats_batch
from app.services.network_settings import get_network_setting_row
from app.services.operator import get_operator_user_id, select_operator_channels
from app.services.scraper_jobs import create_job, has_active_sync_job
from app.services.sync_orchestrator import run_sync_job
from app.services.sync_schedule import due_reason, is_channel_due, needs_dynamic_stats

logger = logging.getLogger(__name__)

CHECK_SOURCE = "Auto Sync (scheduler)"


def _update_sync_state(session: Session, updates: dict[str, Any]) -> None:
    current = load_sync_settings(session)
    current.update(updates)
    save_setting(session, "sync", current)


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


def _stats_for_scheduling(
    session: Session,
    channels: list[Channel],
    groups_by_id: dict[str, Any],
    now_ms: int,
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
    """
    wanted = [
        ch.name
        for ch in channels
        if (group := groups_by_id.get(ch.setting_group_id)) is not None
        and needs_dynamic_stats(_schedule_view(ch, group, None), now_ms)
    ]
    if not wanted:
        return {}
    return compute_channel_stats_batch(session, wanted)


async def run_auto_sync() -> dict[str, Any]:
    """Trigger sync for channels stale beyond configured interval."""
    with Session(engine) as session:
        sync_cfg = load_sync_settings(session)
        now = int(time.time() * 1000)
        pause_until = sync_cfg.get("autoSyncPauseUntil")
        if pause_until and now < int(pause_until):
            return {"skipped": True, "reason": "paused", "pauseUntil": pause_until}
        if pause_until and now >= int(pause_until):
            _update_sync_state(
                session, {"autoSyncPauseUntil": None, "consecutiveFailures": 0}
            )

        if has_active_sync_job():
            return {"skipped": True, "reason": "sync_job_active"}

        net_row = get_network_setting_row(session)
        owner_id = (net_row.user_id if net_row else None) or get_operator_user_id(
            session
        )
        channels = select_operator_channels(session, operator_id=owner_id)
        groups_by_id = load_groups_by_id(session)
        stats_by_channel = _stats_for_scheduling(session, channels, groups_by_id, now)
        due_channels: list[Channel] = []
        due_reason_by_id: dict[str, str] = {}
        for channel in channels:
            group = groups_by_id.get(channel.setting_group_id)
            if group is None:
                continue
            schedule_view = _schedule_view(
                channel, group, stats_by_channel.get(channel.name)
            )
            if not is_channel_due(schedule_view, now):
                continue
            reason = due_reason(schedule_view, now)
            if reason is None:
                continue
            due_channels.append(channel)
            due_reason_by_id[channel.id] = reason

        due_ids = {ch.id for ch in due_channels}
        partial_candidates = [
            ch
            for ch in channels
            if (
                groups_by_id.get(ch.setting_group_id) is not None
                and not groups_by_id[ch.setting_group_id].is_frozen
                and not ch.history_complete_to_cutoff
                and ch.id not in due_ids
            )
        ]
        partial_batch: list[Channel] = []
        if partial_candidates:
            partial_sorted = sorted(partial_candidates, key=lambda ch: ch.id)
            cursor = int(sync_cfg.get("autoSyncPartialCursor") or 0)
            batch_size = max(1, int(sync_cfg.get("autoSyncPartialBatchSize") or 1))
            for i in range(min(batch_size, len(partial_sorted))):
                idx = (cursor + i) % len(partial_sorted)
                partial_batch.append(partial_sorted[idx])
            _update_sync_state(
                session, {"autoSyncPartialCursor": cursor + len(partial_batch)}
            )

        to_sync: list[Channel] = []
        seen_ids: set[str] = set()
        for channel in due_channels + partial_batch:
            if channel.id in seen_ids:
                continue
            seen_ids.add(channel.id)
            to_sync.append(channel)

        if not to_sync:
            return {
                "skipped": True,
                "reason": "no_due_channels",
                "checked": len(channels),
                "partialCandidates": len(partial_candidates),
            }

        entries = [(ch.id, ch.name) for ch in to_sync]
        job = await create_job(
            channel_entries=entries,
            source=CHECK_SOURCE,
            user_id=str(owner_id) if owner_id else None,
            channel_meta_by_id={
                ch.id: {"dueReason": due_reason_by_id.get(ch.id)} for ch in to_sync
            },
        )
        await run_sync_job(job, owner_id)

        failures = [ch for ch in job.channels.values() if ch.status == "failed"]
        successes = [ch for ch in job.channels.values() if ch.status == "success"]

        with Session(engine) as session2:
            sync_cfg = load_sync_settings(session2)
            if failures:
                prev_failures = int(sync_cfg.get("consecutiveFailures") or 0)
                next_failures = prev_failures + len(failures)
                updates: dict[str, Any] = {"consecutiveFailures": next_failures}
                threshold = max(settings.AUTO_SYNC_FAILURE_THRESHOLD_MIN, len(channels))
                if next_failures >= threshold:
                    updates["autoSyncPauseUntil"] = (
                        now + settings.AUTO_SYNC_PAUSE_DURATION_MS
                    )
                    logger.warning(
                        "Auto-sync paused for 10 minutes after %s consecutive failures",
                        next_failures,
                    )
                _update_sync_state(session2, updates)
            elif successes:
                _update_sync_state(session2, {"consecutiveFailures": 0})

        return {
            "jobId": job.job_id,
            "channels": len(to_sync),
            "dueChannels": len(due_channels),
            "partialChannels": len(partial_batch),
            "dueRegular": sum(
                1 for reason in due_reason_by_id.values() if reason == "regular"
            ),
            "dueDynamic": sum(
                1 for reason in due_reason_by_id.values() if reason == "dynamic"
            ),
            "dueBoth": sum(
                1 for reason in due_reason_by_id.values() if reason == "both"
            ),
            "failures": len(failures),
            "successes": len(successes),
            "status": job.status,
        }
