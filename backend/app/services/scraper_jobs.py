"""Persistent sync job registry (Phase 4.5 — DECISION #9)."""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlmodel import Session, delete

from app.core.config import settings
from app.core.db import engine
from app.models_tg import SyncJob as SyncJobRow
from app.models_tg import utc_now
from app.services.channel_setting_groups import SyncOperationMode

_channel_locks: dict[str, asyncio.Lock] = {}
_cancel_events: dict[str, asyncio.Event] = {}
_active_jobs: dict[str, SyncJobState] = {}
_jobs_lock = asyncio.Lock()

_TERMINAL_JOB_STATUSES = frozenset({"completed", "failed", "cancelled"})


def _channel_lock(channel_name: str) -> asyncio.Lock:
    if channel_name not in _channel_locks:
        _channel_locks[channel_name] = asyncio.Lock()
    return _channel_locks[channel_name]


@dataclass
class ChannelSyncState:
    channel_id: str
    channel_name: str
    status: str = "pending"
    posts_fetched: int = 0
    new_latest_id: int | None = None
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_camel(self) -> dict[str, Any]:
        return {
            "channelId": self.channel_id,
            "channelName": self.channel_name,
            "status": self.status,
            "postsFetched": self.posts_fetched,
            "newLatestId": self.new_latest_id,
            "error": self.error,
            "metadata": self.metadata,
        }


@dataclass
class SyncJobState:
    job_id: str
    source: str
    status: str = "pending"
    channels: dict[str, ChannelSyncState] = field(default_factory=dict)
    created_at: int = field(default_factory=lambda: int(time.time() * 1000))
    finished_at: int | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    user_id: str | None = None
    sync_mode: SyncOperationMode = "auto"
    _update_condition: asyncio.Condition = field(
        default_factory=asyncio.Condition, repr=False
    )
    _update_seq: int = field(default=0, repr=False)
    _flushed_job_status: str = field(default="", repr=False)
    _flushed_channel_statuses: dict[str, str] = field(default_factory=dict, repr=False)
    _last_persist_at_ms: float = field(default=0.0, repr=False)

    def to_camel(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "status": self.status,
            "source": self.source,
            "channels": [ch.to_camel() for ch in self.channels.values()],
            "createdAt": self.created_at,
            "finishedAt": self.finished_at,
        }


def _channels_to_json(channels: dict[str, ChannelSyncState]) -> list[dict[str, Any]]:
    return [ch.to_camel() for ch in channels.values()]


def _channels_from_json(data: list[dict[str, Any]]) -> dict[str, ChannelSyncState]:
    result: dict[str, ChannelSyncState] = {}
    for ch in data:
        cid = ch["channelId"]
        result[cid] = ChannelSyncState(
            channel_id=cid,
            channel_name=ch["channelName"],
            status=ch.get("status", "pending"),
            posts_fetched=ch.get("postsFetched", 0),
            new_latest_id=ch.get("newLatestId"),
            error=ch.get("error"),
            metadata=ch.get("metadata") or {},
        )
    return result


def _channel_statuses(job: SyncJobState) -> dict[str, str]:
    return {cid: ch.status for cid, ch in job.channels.items()}


def _mark_flushed(job: SyncJobState) -> None:
    job._flushed_job_status = job.status
    job._flushed_channel_statuses = _channel_statuses(job)
    job._last_persist_at_ms = time.monotonic() * 1000


def _should_flush_db(job: SyncJobState) -> bool:
    if job.status in _TERMINAL_JOB_STATUSES:
        return True
    if job.status != job._flushed_job_status:
        return True
    if _channel_statuses(job) != job._flushed_channel_statuses:
        return True
    elapsed_ms = time.monotonic() * 1000 - job._last_persist_at_ms
    return elapsed_ms >= settings.SYNC_JOB_PERSIST_INTERVAL_MS


def _get_cancel_event(job_id: str) -> asyncio.Event:
    if job_id not in _cancel_events:
        _cancel_events[job_id] = asyncio.Event()
    return _cancel_events[job_id]


def _row_to_state(row: SyncJobRow) -> SyncJobState:
    cancel_event = _get_cancel_event(row.id)
    if row.status == "cancelled":
        cancel_event.set()
    job = SyncJobState(
        job_id=row.id,
        source=row.source,
        status=row.status,
        channels=_channels_from_json(row.channels),
        created_at=row.created_at,
        finished_at=row.finished_at,
        cancel_event=cancel_event,
        user_id=str(row.user_id) if row.user_id else None,
    )
    _mark_flushed(job)
    return job


def _persist_job(job: SyncJobState) -> None:
    with Session(engine) as session:
        row = session.get(SyncJobRow, job.job_id)
        if row is None:
            uid = uuid.UUID(job.user_id) if job.user_id else None
            row = SyncJobRow(
                id=job.job_id,
                user_id=uid,
                status=job.status,
                source=job.source,
                channels=_channels_to_json(job.channels),
                created_at=job.created_at,
                finished_at=job.finished_at,
            )
        else:
            row.status = job.status
            row.channels = _channels_to_json(job.channels)
            row.finished_at = job.finished_at
            row.updated_at = utc_now()
        session.add(row)
        session.commit()


async def _notify_job_update(job: SyncJobState) -> None:
    async with job._update_condition:
        job._update_seq += 1
        job._update_condition.notify_all()


async def touch_job(job: SyncJobState) -> None:
    """Update in-memory job state, notify SSE subscribers, flush DB when needed."""
    should_flush = False
    async with _jobs_lock:
        _active_jobs[job.job_id] = job
        should_flush = _should_flush_db(job)

    if should_flush:
        await asyncio.to_thread(_persist_job, job)
        async with _jobs_lock:
            _mark_flushed(job)

    await _notify_job_update(job)


async def persist_job(job: SyncJobState) -> None:
    """Force a DB flush (job create, cancel, terminal)."""
    await asyncio.to_thread(_persist_job, job)
    async with _jobs_lock:
        _mark_flushed(job)
        _active_jobs[job.job_id] = job
    await _notify_job_update(job)


async def wait_job_update(job: SyncJobState, *, seen_seq: int, timeout_s: float) -> int:
    """Wait until the job is updated or timeout. Returns the current update seq."""
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


async def create_job(
    *,
    channel_entries: list[tuple[str, str]],
    source: str,
    user_id: str | None = None,
    channel_meta_by_id: dict[str, dict[str, Any]] | None = None,
    sync_mode: SyncOperationMode = "auto",
) -> SyncJobState:
    job_id = str(uuid.uuid4())
    channels = {
        cid: ChannelSyncState(
            channel_id=cid,
            channel_name=name,
            metadata=(channel_meta_by_id or {}).get(cid, {}),
        )
        for cid, name in channel_entries
    }
    job = SyncJobState(
        job_id=job_id,
        source=source,
        channels=channels,
        user_id=user_id,
        sync_mode=sync_mode,
        cancel_event=_get_cancel_event(job_id),
    )
    await persist_job(job)
    async with _jobs_lock:
        _active_jobs[job_id] = job
    return job


def get_job(job_id: str) -> SyncJobState | None:
    if job_id in _active_jobs:
        return _active_jobs[job_id]
    with Session(engine) as session:
        row = session.get(SyncJobRow, job_id)
        if row is None:
            return None
        return _row_to_state(row)


async def cancel_job(job_id: str) -> SyncJobState | None:
    job = get_job(job_id)
    if job is None:
        return None
    job.cancel_event.set()
    if job.status in ("pending", "running"):
        job.status = "cancelled"
        job.finished_at = int(time.time() * 1000)
        for ch in job.channels.values():
            if ch.status in ("pending", "running"):
                ch.status = "cancelled"
    await persist_job(job)
    return job


def acquire_channel(channel_name: str) -> asyncio.Lock:
    return _channel_lock(channel_name)


def deactivate_job(job_id: str) -> None:
    """Drop in-memory handles after a job finishes."""
    _active_jobs.pop(job_id, None)
    _cancel_events.pop(job_id, None)


def has_active_sync_job() -> bool:
    """True when a sync job is pending or running (single-instance guard)."""
    return any(j.status in ("pending", "running") for j in _active_jobs.values())


def get_active_sync_job_summary(
    *, allowed_concurrency: int, effective_proxy_capacity: int | None = None
) -> dict[str, Any] | None:
    """Snapshot of the in-flight sync job for runtime config / diagnostics."""
    for job in _active_jobs.values():
        if job.status not in ("pending", "running"):
            continue
        running_channels = sum(
            1 for ch in job.channels.values() if ch.status == "running"
        )
        pending_channels = sum(
            1 for ch in job.channels.values() if ch.status == "pending"
        )
        return {
            "jobId": job.job_id,
            "status": job.status,
            "source": job.source,
            "channelCount": len(job.channels),
            "runningChannels": running_channels,
            "pendingChannels": pending_channels,
            "allowedConcurrency": allowed_concurrency,
            "concurrencyInUse": min(running_channels, allowed_concurrency),
            "effectiveProxyCapacity": effective_proxy_capacity,
        }
    return None


def clear_active_jobs_for_tests() -> None:
    """Simulate backend restart — in-memory state only."""
    _active_jobs.clear()
    _cancel_events.clear()


def clear_jobs_for_tests() -> None:
    """Test helper — reset registry and delete persisted rows."""
    _active_jobs.clear()
    _cancel_events.clear()
    _channel_locks.clear()
    with Session(engine) as session:
        session.exec(delete(SyncJobRow))
        session.commit()
