"""Discover bulk-follow job: scrape+create channels, then chain one sync job."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlmodel import Session

from app.core.db import engine
from app.jobs.settings import (
    compute_effective_global_start_time_ms,
    load_retention_settings,
    load_sync_settings,
)
from app.services.async_db import run_db
from app.services.followed_channels import (
    channel_exists,
    create_followed_channel,
    normalize_channel_name,
)
from app.services.network_settings import (
    load_network_settings,
    resolve_proxy_concurrency,
)
from app.services.scraper import get_channel_info
from app.services.telegram_web import telegram_web_view_channel_url

logger = logging.getLogger(__name__)

FOLLOW_SCRAPE_CONCURRENCY = 4
FOLLOW_JOB_SOURCE = "Discover bulk follow"
_TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})
_TERMINAL_CHANNEL_STATUSES = frozenset(
    {"added", "unavailable", "skipped", "error", "cancelled"}
)

FollowResultStatus = Literal[
    "pending", "running", "added", "unavailable", "skipped", "error", "cancelled"
]


@dataclass
class FollowChannelResult:
    name: str
    status: FollowResultStatus = "pending"
    reason: str | None = None
    error: str | None = None

    def to_camel(self) -> dict[str, Any]:
        out: dict[str, Any] = {"name": self.name, "status": self.status}
        if self.reason is not None:
            out["reason"] = self.reason
        if self.error is not None:
            out["error"] = self.error
        return out


@dataclass
class FollowJobState:
    follow_job_id: str
    source: str = FOLLOW_JOB_SOURCE
    status: str = "pending"
    results: list[FollowChannelResult] = field(default_factory=list)
    sync_job_id: str | None = None
    created_at: int = field(default_factory=lambda: int(time.time() * 1000))
    finished_at: int | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    user_id: str | None = None
    proxies: list[str] = field(default_factory=list)
    tor_auto_rotate: bool = False
    tor_rotation_threshold: int = 10
    discovered_via_by_name: dict[str, dict[str, Any] | None] = field(
        default_factory=dict
    )
    _update_condition: asyncio.Condition = field(
        default_factory=asyncio.Condition, repr=False
    )
    _update_seq: int = field(default=0, repr=False)

    def _counts(self) -> dict[str, int]:
        added = skipped = unavailable = failed = completed = 0
        for r in self.results:
            if r.status in _TERMINAL_CHANNEL_STATUSES:
                completed += 1
            if r.status == "added":
                added += 1
            elif r.status == "skipped":
                skipped += 1
            elif r.status == "unavailable":
                unavailable += 1
            elif r.status == "error":
                failed += 1
        return {
            "total": len(self.results),
            "completed": completed,
            "added": added,
            "skipped": skipped,
            "unavailable": unavailable,
            "failed": failed,
        }

    def to_camel(self) -> dict[str, Any]:
        counts = self._counts()
        return {
            "followJobId": self.follow_job_id,
            "status": self.status,
            "source": self.source,
            "total": counts["total"],
            "completed": counts["completed"],
            "added": counts["added"],
            "skipped": counts["skipped"],
            "unavailable": counts["unavailable"],
            "failed": counts["failed"],
            "results": [r.to_camel() for r in self.results],
            "syncJobId": self.sync_job_id,
            "createdAt": self.created_at,
            "finishedAt": self.finished_at,
        }


_active_jobs: dict[str, FollowJobState] = {}
_jobs_lock = asyncio.Lock()
_create_lock = asyncio.Lock()


async def _notify_job_update(job: FollowJobState) -> None:
    async with job._update_condition:
        job._update_seq += 1
        job._update_condition.notify_all()


async def touch_follow_job(job: FollowJobState) -> None:
    async with _jobs_lock:
        _active_jobs[job.follow_job_id] = job
    await _notify_job_update(job)


async def wait_follow_job_update(
    job: FollowJobState, *, seen_seq: int, timeout_s: float
) -> int:
    async with job._update_condition:
        if job._update_seq > seen_seq:
            return job._update_seq
        try:
            await asyncio.wait_for(
                job._update_condition.wait_for(lambda: job._update_seq > seen_seq),
                timeout=timeout_s,
            )
        except TimeoutError:
            pass
        return job._update_seq


def get_follow_job(follow_job_id: str) -> FollowJobState | None:
    return _active_jobs.get(follow_job_id)


async def create_follow_job(
    *,
    channels: list[dict[str, Any]],
    user_id: str | None,
    proxies: list[str] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int = 10,
) -> FollowJobState:
    """Normalize + dedupe input and create an in-memory follow job."""
    seen: set[str] = set()
    results: list[FollowChannelResult] = []
    via_by_name: dict[str, dict[str, Any] | None] = {}

    for entry in channels:
        raw_name = entry.get("name") or ""
        clean = normalize_channel_name(str(raw_name))
        if not clean or clean.lower() in seen:
            continue
        seen.add(clean.lower())
        via = entry.get("discovered_via") or entry.get("discoveredVia")
        via_by_name[clean] = via if isinstance(via, dict) else None
        results.append(FollowChannelResult(name=clean))

    job = FollowJobState(
        follow_job_id=str(uuid.uuid4()),
        results=results,
        user_id=user_id,
        proxies=list(proxies or []),
        tor_auto_rotate=tor_auto_rotate,
        tor_rotation_threshold=tor_rotation_threshold,
        discovered_via_by_name=via_by_name,
    )
    async with _jobs_lock:
        _active_jobs[job.follow_job_id] = job
    await _notify_job_update(job)
    return job


async def cancel_follow_job(follow_job_id: str) -> FollowJobState | None:
    job = get_follow_job(follow_job_id)
    if job is None:
        return None
    job.cancel_event.set()
    if job.status in ("pending", "running"):
        job.status = "cancelled"
        job.finished_at = int(time.time() * 1000)
        for r in job.results:
            if r.status in ("pending", "running"):
                r.status = "cancelled"
    await touch_follow_job(job)
    return job


def clear_follow_jobs_for_tests() -> None:
    _active_jobs.clear()


def _load_effective_start_time(_user_id: uuid.UUID | None) -> int:
    with Session(engine) as session:
        sync_settings = load_sync_settings(session)
        retention_settings = load_retention_settings(session)
        return compute_effective_global_start_time_ms(sync_settings, retention_settings)


def _load_proxy_concurrency(
    user_id: uuid.UUID | None,
) -> tuple[int, dict[str, int]] | None:
    if user_id is None:
        return None
    with Session(engine) as session:
        network = load_network_settings(session, user_id)
        return resolve_proxy_concurrency(network)


async def _process_one_channel(
    job: FollowJobState,
    result: FollowChannelResult,
    *,
    user_uuid: uuid.UUID | None,
    effective_start_time: int,
    proxy_concurrency: tuple[int, dict[str, int]] | None,
) -> None:
    if job.cancel_event.is_set():
        result.status = "cancelled"
        await touch_follow_job(job)
        return

    exists = await run_db(channel_exists, result.name)
    if exists:
        result.status = "skipped"
        result.reason = "already_followed"
        await touch_follow_job(job)
        return

    result.status = "running"
    await touch_follow_job(job)

    if job.cancel_event.is_set():
        result.status = "cancelled"
        await touch_follow_job(job)
        return

    display_name = result.name
    photo_url: str | None = None
    is_unavailable = False
    telemetry = None
    try:
        info = await get_channel_info(
            result.name,
            proxies=job.proxies or None,
            tor_auto_rotate=job.tor_auto_rotate,
            tor_rotation_threshold=job.tor_rotation_threshold,
            proxy_concurrency=proxy_concurrency,
        )
        display_name = info.get("displayName") or result.name
        photo_url = info.get("photoUrl")
        is_unavailable = bool(info.get("isUnavailableOnWebView"))
        telemetry = info.get("telemetry")
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "not available on the web view" in msg.lower():
            is_unavailable = True
        else:
            result.status = "error"
            result.error = msg
            await touch_follow_job(job)
            return

    if job.cancel_event.is_set():
        result.status = "cancelled"
        await touch_follow_job(job)
        return

    discovered_via = job.discovered_via_by_name.get(result.name)
    # Serialize creates: concurrent touch_sync / group ensure races under load.
    async with _create_lock:
        created = await run_db(
            create_followed_channel,
            result.name,
            display_name=display_name,
            photo_url=photo_url,
            is_unavailable=is_unavailable,
            discovered_via=discovered_via,
            user_id=user_uuid,
            effective_start_time=effective_start_time,
            telemetry_url=telegram_web_view_channel_url(result.name),
            telemetry=telemetry,
        )
    if not created:
        result.status = "skipped"
        result.reason = "already_followed"
    elif is_unavailable:
        result.status = "unavailable"
    else:
        result.status = "added"
    await touch_follow_job(job)


async def _chain_sync_job(
    job: FollowJobState, syncable_names: list[str], user_uuid: uuid.UUID | None
) -> None:
    if not syncable_names:
        return
    from app.services.scraper_jobs import create_job
    from app.services.sync_orchestrator import run_sync_job

    entries = [(name, name) for name in syncable_names]
    sync_job = await create_job(
        channel_entries=entries,
        source=FOLLOW_JOB_SOURCE,
        user_id=job.user_id,
        sync_mode="bulk",
    )
    job.sync_job_id = sync_job.job_id
    asyncio.create_task(run_sync_job(sync_job, user_uuid))


async def run_follow_job(job: FollowJobState) -> None:
    job.status = "running"
    await touch_follow_job(job)

    user_uuid = uuid.UUID(job.user_id) if job.user_id else None
    effective_start_time = await run_db(_load_effective_start_time, user_uuid)
    proxy_concurrency = await run_db(_load_proxy_concurrency, user_uuid)
    sem = asyncio.Semaphore(FOLLOW_SCRAPE_CONCURRENCY)

    async def _run_one(result: FollowChannelResult) -> None:
        async with sem:
            try:
                await _process_one_channel(
                    job,
                    result,
                    user_uuid=user_uuid,
                    effective_start_time=effective_start_time,
                    proxy_concurrency=proxy_concurrency,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception("Bulk follow failed for @%s", result.name)
                if result.status not in _TERMINAL_CHANNEL_STATUSES:
                    result.status = "error"
                    result.error = str(exc)
                    await touch_follow_job(job)

    await asyncio.gather(*[_run_one(r) for r in job.results])

    if job.cancel_event.is_set():
        job.status = "cancelled"
        for r in job.results:
            if r.status in ("pending", "running"):
                r.status = "cancelled"
    else:
        syncable_names = [r.name for r in job.results if r.status == "added"]
        try:
            await _chain_sync_job(job, syncable_names, user_uuid)
        except Exception:  # noqa: BLE001
            logger.exception(
                "Failed to chain sync job after follow job %s", job.follow_job_id
            )
        if any(r.status == "error" for r in job.results) and not any(
            r.status in ("added", "unavailable", "skipped") for r in job.results
        ):
            job.status = "failed"
        else:
            job.status = "completed"

    job.finished_at = int(time.time() * 1000)
    await touch_follow_job(job)
