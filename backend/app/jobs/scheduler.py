"""APScheduler background jobs for always-on self-hosted deployment.

Single-instance assumption (ADR-004): one backend container runs one in-process
AsyncIOScheduler. Do not run multiple replicas without external job coordination.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.jobs.auto_summary import run_auto_summary
from app.jobs.auto_sync import run_auto_sync
from app.jobs.retention import run_retention_cleanup
from app.jobs.settings import (
    JOB_IDS,
    default_job_enabled,
    is_job_enabled,
    load_jobs_settings,
    set_job_enabled,
)
from app.jobs.translation_batch import run_translation_batch
from app.services.embeddings import backfill_embeddings

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

_job_status: dict[str, dict[str, Any]] = {
    job_id: {
        "enabled": default_job_enabled(job_id),
        "lastRun": None,
        "lastStatus": "idle",
        "lastError": None,
        "nextRun": None,
    }
    for job_id in JOB_IDS
}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _next_run_ms(job_id: str) -> int | None:
    job = scheduler.get_job(job_id)
    if not job or not job.next_run_time:
        return None
    return int(job.next_run_time.timestamp() * 1000)


def _mark_running(job_id: str) -> None:
    _job_status[job_id]["lastRun"] = _now_ms()
    _job_status[job_id]["lastStatus"] = "running"
    _job_status[job_id]["lastError"] = None


def _mark_ok(job_id: str, detail: Any = None) -> None:
    _job_status[job_id]["lastStatus"] = "ok"
    _job_status[job_id]["lastError"] = None
    _job_status[job_id]["nextRun"] = _next_run_ms(job_id)
    if detail is not None:
        _job_status[job_id]["detail"] = detail


def _mark_error(job_id: str, exc: Exception) -> None:
    _job_status[job_id]["lastStatus"] = "error"
    _job_status[job_id]["lastError"] = str(exc)
    _job_status[job_id]["nextRun"] = _next_run_ms(job_id)
    logger.exception("Job %s failed", job_id)


async def _run_guarded(job_id: str, fn: Callable[[], Awaitable[Any]]) -> None:
    with Session(engine) as session:
        if not is_job_enabled(session, job_id):
            _job_status[job_id]["enabled"] = False
            _job_status[job_id]["lastStatus"] = "disabled"
            _job_status[job_id]["nextRun"] = _next_run_ms(job_id)
            return
        _job_status[job_id]["enabled"] = True

    _mark_running(job_id)
    try:
        result = await fn()
        _mark_ok(job_id, result)
    except Exception as exc:  # noqa: BLE001
        _mark_error(job_id, exc)


async def job_auto_sync() -> None:
    await _run_guarded("auto_sync", run_auto_sync)


async def job_embeddings() -> None:
    async def _run() -> dict[str, Any]:
        with Session(engine) as session:
            return await backfill_embeddings(session, limit=100)

    await _run_guarded("embeddings", _run)


async def job_auto_summary() -> None:
    await _run_guarded("auto_summary", run_auto_summary)


async def job_retention() -> None:
    async def _run() -> dict[str, Any]:
        with Session(engine) as session:
            return run_retention_cleanup(session)

    await _run_guarded("retention", _run)


async def job_translation_batch() -> None:
    await _run_guarded("translation_batch", run_translation_batch)


_JOB_RUNNERS: dict[str, Callable[[], Awaitable[None]]] = {
    "auto_sync": job_auto_sync,
    "embeddings": job_embeddings,
    "auto_summary": job_auto_summary,
    "retention": job_retention,
    "translation_batch": job_translation_batch,
}


def _refresh_enabled_flags() -> None:
    with Session(engine) as session:
        jobs_cfg = load_jobs_settings(session)
        for job_id in JOB_IDS:
            entry = jobs_cfg.get(job_id, {})
            enabled = (
                bool(entry.get("enabled", default_job_enabled(job_id)))
                if isinstance(entry, dict)
                else default_job_enabled(job_id)
            )
            _job_status[job_id]["enabled"] = enabled
            _job_status[job_id]["nextRun"] = _next_run_ms(job_id)


def get_job_status() -> dict[str, Any]:
    _refresh_enabled_flags()
    status = {job_id: dict(data) for job_id, data in _job_status.items()}
    with Session(engine) as session:
        from app.jobs.settings import load_sync_settings

        sync_cfg = load_sync_settings(session)
        if sync_cfg.get("autoSyncPauseUntil"):
            status["auto_sync"]["pauseUntil"] = sync_cfg["autoSyncPauseUntil"]
    return status


async def trigger_job(job_id: str) -> dict[str, Any]:
    runner = _JOB_RUNNERS.get(job_id)
    if not runner:
        raise ValueError(f"Unknown job: {job_id}")
    await runner()
    result: dict[str, Any] = dict(get_job_status()[job_id])
    return result


def set_job_enabled_flag(job_id: str, enabled: bool) -> dict[str, Any]:
    if job_id not in JOB_IDS:
        raise ValueError(f"Unknown job: {job_id}")
    with Session(engine) as session:
        set_job_enabled(session, job_id, enabled)
    ap_job = scheduler.get_job(job_id)
    if ap_job:
        if enabled:
            ap_job.resume()
        else:
            ap_job.pause()
    _job_status[job_id]["enabled"] = enabled
    _job_status[job_id]["nextRun"] = _next_run_ms(job_id)
    result: dict[str, Any] = dict(get_job_status()[job_id])
    return result


def _retention_startup_kwargs() -> dict[str, Any]:
    """First-run timing for the retention job.

    An interval job's first run is otherwise start+interval away, so on a
    frequently-redeployed backend the sweep can be reset before it ever
    fires. A next_run_time makes retention also run shortly after boot; the
    delay lets startup settle first. Returns empty (interval-only) when the
    delay is 0.
    """
    delay = settings.RETENTION_JOB_STARTUP_DELAY_SECONDS
    if delay <= 0:
        return {}
    # Naive local time matches AsyncIOScheduler's default timezone.
    return {"next_run_time": datetime.now() + timedelta(seconds=delay)}


def start_scheduler() -> None:
    if scheduler.running:
        return

    scheduler.add_job(
        job_auto_sync,
        "interval",
        seconds=settings.AUTO_SYNC_CHECK_INTERVAL_SECONDS,
        id="auto_sync",
        replace_existing=True,
    )
    scheduler.add_job(
        job_embeddings,
        "interval",
        seconds=settings.EMBEDDINGS_JOB_INTERVAL_SECONDS,
        id="embeddings",
        replace_existing=True,
    )
    scheduler.add_job(
        job_auto_summary,
        "interval",
        seconds=settings.AUTO_SUMMARY_JOB_INTERVAL_SECONDS,
        id="auto_summary",
        replace_existing=True,
    )
    scheduler.add_job(
        job_retention,
        "interval",
        hours=settings.RETENTION_JOB_INTERVAL_HOURS,
        id="retention",
        replace_existing=True,
        **_retention_startup_kwargs(),
    )
    scheduler.add_job(
        job_translation_batch,
        "interval",
        seconds=settings.TRANSLATION_BATCH_JOB_INTERVAL_SECONDS,
        id="translation_batch",
        replace_existing=True,
    )

    with Session(engine) as session:
        jobs_cfg = load_jobs_settings(session)
        for job_id in JOB_IDS:
            entry = jobs_cfg.get(job_id, {})
            if isinstance(entry, dict) and not entry.get(
                "enabled", default_job_enabled(job_id)
            ):
                ap_job = scheduler.get_job(job_id)
                if ap_job:
                    ap_job.pause()
                _job_status[job_id]["enabled"] = False

    scheduler.start()
    _refresh_enabled_flags()
    logger.info("APScheduler started (single-instance in-process job runner)")


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
