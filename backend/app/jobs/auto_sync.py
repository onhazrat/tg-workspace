"""Auto-sync stale channels (replaces App.tsx 60s client interval)."""

from __future__ import annotations

import asyncio
import logging
import time
from sqlmodel import Session, select

from app.core.db import engine
from app.jobs.settings import load_sync_settings, save_setting
from app.models_tg import Channel
from app.services.network_settings import get_network_setting_row
from app.services.scraper_jobs import create_job, has_active_sync_job
from app.services.sync_orchestrator import run_sync_job

logger = logging.getLogger(__name__)

PAUSE_DURATION_MS = 10 * 60 * 1000
CHECK_SOURCE = "Auto Sync (scheduler)"


def _update_sync_state(session: Session, updates: dict) -> None:
    current = load_sync_settings(session)
    current.update(updates)
    save_setting(session, "sync", current)


async def run_auto_sync() -> dict:
    """Trigger sync for channels stale beyond configured interval."""
    with Session(engine) as session:
        sync_cfg = load_sync_settings(session)
        if not sync_cfg.get("autoSyncEnabled", True):
            return {"skipped": True, "reason": "auto_sync_disabled"}

        now = int(time.time() * 1000)
        pause_until = sync_cfg.get("autoSyncPauseUntil")
        if pause_until and now < int(pause_until):
            return {"skipped": True, "reason": "paused", "pauseUntil": pause_until}
        if pause_until and now >= int(pause_until):
            _update_sync_state(session, {"autoSyncPauseUntil": None, "consecutiveFailures": 0})

        if has_active_sync_job():
            return {"skipped": True, "reason": "sync_job_active"}

        interval_min = int(sync_cfg.get("autoSyncInterval") or 60)
        interval_ms = interval_min * 60 * 1000

        channels = session.exec(select(Channel).where(Channel.is_frozen == False)).all()  # noqa: E712
        stale = [
            ch
            for ch in channels
            if (now - (ch.last_updated or 0)) >= interval_ms
        ]
        if not stale:
            return {"skipped": True, "reason": "no_stale_channels", "checked": len(channels)}

        entries = [(ch.id, ch.name) for ch in stale]
        net_row = get_network_setting_row(session)
        owner_id = net_row.user_id if net_row else None
        job = await create_job(
            channel_entries=entries,
            source=CHECK_SOURCE,
            user_id=str(owner_id) if owner_id else None,
        )
        await run_sync_job(job, owner_id)

        failures = [ch for ch in job.channels.values() if ch.status == "failed"]
        successes = [ch for ch in job.channels.values() if ch.status == "success"]

        with Session(engine) as session2:
            sync_cfg = load_sync_settings(session2)
            if failures:
                prev_failures = int(sync_cfg.get("consecutiveFailures") or 0)
                next_failures = prev_failures + len(failures)
                updates: dict = {"consecutiveFailures": next_failures}
                threshold = max(3, len(channels))
                if next_failures >= threshold:
                    updates["autoSyncPauseUntil"] = now + PAUSE_DURATION_MS
                    logger.warning(
                        "Auto-sync paused for 10 minutes after %s consecutive failures",
                        next_failures,
                    )
                _update_sync_state(session2, updates)
            elif successes:
                _update_sync_state(session2, {"consecutiveFailures": 0})

        return {
            "jobId": job.job_id,
            "channels": len(stale),
            "failures": len(failures),
            "successes": len(successes),
            "status": job.status,
        }
