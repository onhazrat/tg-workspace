import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.jobs.scheduler import get_job_status, set_job_enabled_flag, trigger_job
from app.jobs.settings import JOB_IDS
from app.schemas.jobs import JobStatusEntry, UpdateJobRequest
from app.schemas.runtime_config import RuntimeConfigResponse
from app.schemas.sync_jobs import (
    CancelSyncJobResponse,
    StartSyncJobRequest,
    StartSyncJobResponse,
    SyncJobStatusResponse,
)
from app.services.channel_setting_groups import (
    channel_allows_sync_operation,
    load_groups_by_id,
)
from app.services.operator import get_operator_user_id, select_operator_channels
from app.services.runtime_config import build_runtime_config
from app.services.scraper_jobs import (
    cancel_job,
    create_job,
    get_job,
    wait_job_update,
)
from app.services.sync_orchestrator import run_sync_job

_TERMINAL_SYNC_STATUSES = frozenset({"completed", "failed", "cancelled"})

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _resolve_sync_entries(
    session: Session,
    channel_ids: list[str] | None,
    operator_id: uuid.UUID | None,
    sync_mode: Literal["sync_all", "bulk", "individual", "recheck_restricted"],
) -> list[tuple[str, str]]:
    operator_channels = {
        ch.id: ch for ch in select_operator_channels(session, operator_id=operator_id)
    }
    groups_by_id = load_groups_by_id(session)

    if sync_mode == "sync_all":
        candidates = list(operator_channels.values())
    elif sync_mode == "recheck_restricted":
        candidates = [
            ch
            for ch in operator_channels.values()
            if groups_by_id.get(ch.setting_group_id) is not None
            and groups_by_id[ch.setting_group_id].is_unavailable_on_web_view
        ]
    elif channel_ids:
        candidates = [
            operator_channels[cid] for cid in channel_ids if cid in operator_channels
        ]
    else:
        candidates = list(operator_channels.values())

    entries: list[tuple[str, str]] = []
    for ch in candidates:
        group = groups_by_id.get(ch.setting_group_id)
        if group is None:
            continue
        if channel_allows_sync_operation(group, sync_mode):
            entries.append((ch.id, ch.name))
    return entries


@router.get("/status")
def jobs_status(_current_user: CurrentUser) -> dict[str, JobStatusEntry]:
    return {
        job_id: JobStatusEntry.model_validate(entry)
        for job_id, entry in get_job_status().items()
    }


@router.get("/runtime-config", response_model=RuntimeConfigResponse)
def get_runtime_config(
    session: SessionDep,
    current_user: CurrentUser,
) -> RuntimeConfigResponse:
    payload = build_runtime_config(session, user_id=current_user.id)
    return RuntimeConfigResponse(**payload)


@router.post("/{job_id}/trigger")
async def trigger_scheduler_job(
    job_id: str, _current_user: CurrentUser
) -> JobStatusEntry:
    if job_id not in JOB_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    try:
        return JobStatusEntry.model_validate(await trigger_job(job_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{job_id}")
def update_scheduler_job(
    job_id: str, body: UpdateJobRequest, _current_user: CurrentUser
) -> JobStatusEntry:
    if job_id not in JOB_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    try:
        return JobStatusEntry.model_validate(set_job_enabled_flag(job_id, body.enabled))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/sync", response_model=StartSyncJobResponse)
async def start_sync_job(
    body: StartSyncJobRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> StartSyncJobResponse:
    operator_id = current_user.id or get_operator_user_id(session)
    sync_mode = body.resolved_sync_mode
    entries = _resolve_sync_entries(session, body.channel_ids, operator_id, sync_mode)
    if not entries:
        raise HTTPException(
            status_code=400,
            detail=f"No channels eligible for sync (mode={sync_mode})",
        )

    job = await create_job(
        channel_entries=entries,
        source=body.source,
        user_id=str(current_user.id),
        sync_mode=sync_mode,
    )
    user_uuid = uuid.UUID(str(current_user.id))
    asyncio.create_task(run_sync_job(job, user_uuid))
    return StartSyncJobResponse(jobId=job.job_id)


@router.get("/sync/{job_id}", response_model=SyncJobStatusResponse)
def get_sync_job_status(
    job_id: str, _current_user: CurrentUser
) -> SyncJobStatusResponse:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Sync job not found")
    data = job.to_camel()
    return SyncJobStatusResponse(**data)


def _sync_status_changed(
    previous: dict[str, Any] | None, current: dict[str, Any]
) -> bool:
    if previous is None:
        return True
    if previous.get("status") != current.get("status"):
        return True
    prev_channels = {
        ch["channelId"]: ch["status"] for ch in previous.get("channels", [])
    }
    for ch in current.get("channels", []):
        if prev_channels.get(ch["channelId"]) != ch["status"]:
            return True
    return False


@router.get("/sync/{job_id}/events")
async def sync_job_events(job_id: str, _current_user: CurrentUser) -> StreamingResponse:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Sync job not found")

    throttle_ms = settings.SYNC_JOB_SSE_THROTTLE_MS
    throttle_s = max(throttle_ms, 1) / 1000

    async def event_stream() -> AsyncIterator[str]:
        seen_seq = job._update_seq
        last_sent_at = 0.0
        last_snapshot: dict[str, Any] | None = None

        while True:
            current_job = get_job(job_id)
            if current_job is None:
                break

            snapshot = current_job.to_camel()
            now_ms = time.monotonic() * 1000
            status_changed = _sync_status_changed(last_snapshot, snapshot)
            should_send = (
                last_snapshot is None
                or status_changed
                or now_ms - last_sent_at >= throttle_ms
            )

            if should_send:
                yield f"data: {json.dumps(snapshot)}\n\n"
                last_sent_at = now_ms
                last_snapshot = snapshot

            if snapshot["status"] in _TERMINAL_SYNC_STATUSES:
                yield "data: [DONE]\n\n"
                return

            seen_seq = await wait_job_update(
                current_job, seen_seq=seen_seq, timeout_s=throttle_s
            )

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/sync/{job_id}/cancel", response_model=CancelSyncJobResponse)
async def cancel_sync_job(
    job_id: str, _current_user: CurrentUser
) -> CancelSyncJobResponse:
    job = await cancel_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Sync job not found")
    return CancelSyncJobResponse(jobId=job.job_id, status=job.status)
