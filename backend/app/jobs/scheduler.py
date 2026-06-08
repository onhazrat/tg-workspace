"""APScheduler background jobs for always-on self-hosted deployment."""

from __future__ import annotations

import logging
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()
_job_status: dict[str, Any] = {
    "auto_sync": {"enabled": True, "lastRun": None, "lastStatus": "idle"},
    "embeddings": {"enabled": True, "lastRun": None, "lastStatus": "idle"},
    "retention": {"enabled": True, "lastRun": None, "lastStatus": "idle"},
    "auto_summary": {"enabled": True, "lastRun": None, "lastStatus": "idle"},
}


async def _placeholder_auto_sync() -> None:
    _job_status["auto_sync"]["lastRun"] = "scheduled"
    _job_status["auto_sync"]["lastStatus"] = "ok"
    logger.info("Auto-sync job tick (configure channels via data API)")


async def _placeholder_retention() -> None:
    _job_status["retention"]["lastRun"] = "scheduled"
    _job_status["retention"]["lastStatus"] = "ok"
    logger.info("Retention cleanup job tick")


def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(_placeholder_auto_sync, "interval", minutes=1, id="auto_sync")
    scheduler.add_job(_placeholder_retention, "interval", hours=6, id="retention")
    scheduler.start()
    logger.info("APScheduler started")


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)


def get_job_status() -> dict[str, Any]:
    return _job_status
