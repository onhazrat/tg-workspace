import asyncio
import uuid

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select

from app.api.deps import CurrentUser, SessionDep
from app.jobs.scheduler import get_job_status, set_job_enabled_flag, trigger_job
from app.jobs.settings import JOB_IDS
from app.models_tg import Channel
from app.schemas.jobs import UpdateJobRequest
from app.schemas.sync_jobs import (
    CancelSyncJobResponse,
    StartSyncJobRequest,
    StartSyncJobResponse,
    SyncJobStatusResponse,
)
from app.services.scraper_jobs import cancel_job, create_job, get_job
from app.services.sync_orchestrator import run_sync_job

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _resolve_channel_entries(
    session: Session,
    channel_ids: list[str] | None,
) -> list[tuple[str, str]]:
    if channel_ids:
        entries: list[tuple[str, str]] = []
        for cid in channel_ids:
            ch = session.get(Channel, cid)
            if ch:
                entries.append((ch.id, ch.name))
        return entries

    channels = session.exec(select(Channel).where(Channel.is_frozen == False)).all()  # noqa: E712
    return [(c.id, c.name) for c in channels]


@router.get("/status")
def jobs_status() -> dict:
    return get_job_status()


@router.post("/{job_id}/trigger")
async def trigger_scheduler_job(job_id: str) -> dict:
    if job_id not in JOB_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    try:
        return await trigger_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{job_id}")
def update_scheduler_job(job_id: str, body: UpdateJobRequest) -> dict:
    if job_id not in JOB_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    try:
        return set_job_enabled_flag(job_id, body.enabled)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/sync", response_model=StartSyncJobResponse)
async def start_sync_job(
    body: StartSyncJobRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> StartSyncJobResponse:
    entries = _resolve_channel_entries(session, body.channel_ids)
    if not entries:
        raise HTTPException(status_code=400, detail="No channels to sync")

    job = await create_job(
        channel_entries=entries,
        source=body.source,
        user_id=str(current_user.id),
    )
    user_uuid = uuid.UUID(str(current_user.id))
    asyncio.create_task(run_sync_job(job, user_uuid))
    return StartSyncJobResponse(jobId=job.job_id)


@router.get("/sync/{job_id}", response_model=SyncJobStatusResponse)
def get_sync_job_status(job_id: str) -> SyncJobStatusResponse:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Sync job not found")
    data = job.to_camel()
    return SyncJobStatusResponse(**data)


@router.post("/sync/{job_id}/cancel", response_model=CancelSyncJobResponse)
async def cancel_sync_job(job_id: str) -> CancelSyncJobResponse:
    job = await cancel_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Sync job not found")
    return CancelSyncJobResponse(jobId=job.job_id, status=job.status)
