import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep, require_permission
from app.core.config import settings
from app.core.permissions import Permission
from app.jobs.scheduler import get_job_status, request_job_run, set_job_enabled_flag
from app.jobs.settings import JOB_IDS
from app.jobs.sync_queue import enqueue_sync_job
from app.models import User
from app.schemas.jobs import (
    DrainLaneResponse,
    JobStatusEntry,
    SyncLaneEntry,
    SyncLaneListResponse,
    UpdateJobRequest,
)
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
    SyncJobState,
    cancel_job,
    create_job,
    get_job,
    wait_job_update,
)
from app.services.sync_lane_control import (
    LaneDepth,
    drain_lane,
    lane_depths,
    require_lane,
    set_lane_paused,
)
from app.services.sync_lanes import lane_budget, lane_tier
from app.services.tenancy import assert_owner

_TERMINAL_SYNC_STATUSES = frozenset({"completed", "failed", "cancelled"})

router = APIRouter(prefix="/jobs", tags=["jobs"])

#: The scheduler is deployment machinery (ticket 18). Reading which jobs exist
#: and when they last ran, enabling one, and triggering a run are all the same
#: audience — and `retention` deletes Posts when it runs, so the trigger is
#: destructive even though the other two read like status endpoints.
SCHEDULER_ONLY = [Depends(require_permission(Permission.JOBS_MANAGE))]

#: What the three sync-job routes answer for a job the caller may not see. The
#: same string an absent job gets, because the two must be indistinguishable.
_JOB_NOT_FOUND = "Sync job not found"


def _visible_job(
    job: SyncJobState | None,
    session: Session,
    current_user: User,
) -> SyncJobState:
    """The job, if this caller is allowed to know about it.

    Three cases, and they deliberately answer differently.

    * **Not there** is 404.
    * **Someone else's** is also 404, through `assert_owner` and with the same
      detail, because 403 would confirm the job exists. A no-op while the seam's
      flag is off, like every other adoption of it — `services/tenancy.py` names
      that flag, and this module deliberately does not, because a guard there
      asserts exactly two files in the tree mention it by name.
    * **Nobody's** is 403 unless the caller can manage the scheduler. A job with
      a null owner is one the scheduler started, and decision 23 keeps that
      nullable owner precisely so such a row leaks to an Admin and to nobody
      else. It is 403 rather than 404 because this is an authorisation answer
      about a deployment record, not a claim about whether some other account's
      row exists — there is no owner here for a 404 to protect.
    """
    if not job:
        raise HTTPException(status_code=404, detail=_JOB_NOT_FOUND)
    if job.user_id is None:
        require_permission(Permission.JOBS_MANAGE)(session, current_user)
        return job
    assert_owner(uuid.UUID(job.user_id), current_user.id, detail=_JOB_NOT_FOUND)
    return job


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


@router.get("/status", dependencies=SCHEDULER_ONLY)
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


@router.post("/{job_id}/trigger", dependencies=SCHEDULER_ONLY)
async def trigger_scheduler_job(
    job_id: str, _current_user: CurrentUser
) -> JobStatusEntry:
    if job_id not in JOB_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    try:
        return JobStatusEntry.model_validate(await request_job_run(job_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{job_id}", dependencies=SCHEDULER_ONLY)
def update_scheduler_job(
    job_id: str, body: UpdateJobRequest, _current_user: CurrentUser
) -> JobStatusEntry:
    if job_id not in JOB_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    try:
        return JobStatusEntry.model_validate(set_job_enabled_flag(job_id, body.enabled))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _lane_entry(depth: LaneDepth) -> SyncLaneEntry:
    return SyncLaneEntry(
        lane=depth.lane,
        budget=lane_budget(depth.lane).value,
        tier=lane_tier(depth.lane),
        queued=depth.queued,
        paused=depth.paused,
    )


def _known_lane(lane: str) -> str:
    """404 on a lane that is not one of the six.

    The name reaches SQL as an identifier further down, so this is also where a
    path parameter stops being able to name a table. `require_lane` is the check
    itself, in the service, because the worker validates against the same list.
    """
    try:
        return require_lane(lane)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown lane: {lane}") from exc


@router.get("/lanes", dependencies=SCHEDULER_ONLY, response_model=SyncLaneListResponse)
def list_sync_lanes(session: SessionDep, _current_user: CurrentUser) -> Any:
    """The six lanes, in drain order, with their depth and paused state."""
    return SyncLaneListResponse(lanes=[_lane_entry(d) for d in lane_depths(session)])


@router.post(
    "/lanes/{lane}/pause", dependencies=SCHEDULER_ONLY, response_model=SyncLaneEntry
)
def pause_sync_lane(lane: str, session: SessionDep, _current_user: CurrentUser) -> Any:
    """Stop the worker taking new messages from this lane.

    Reversible and lossless: the messages stay queued and visible, and the next
    drain after a resume picks them up. That is the difference from
    `drain_sync_lane` below, which is neither.
    """
    set_lane_paused(session, _known_lane(lane), paused=True)
    return _lane_entry(_depth_of(session, lane))


@router.post(
    "/lanes/{lane}/resume", dependencies=SCHEDULER_ONLY, response_model=SyncLaneEntry
)
def resume_sync_lane(lane: str, session: SessionDep, _current_user: CurrentUser) -> Any:
    set_lane_paused(session, _known_lane(lane), paused=False)
    return _lane_entry(_depth_of(session, lane))


@router.post(
    "/lanes/{lane}/drain", dependencies=SCHEDULER_ONLY, response_model=DrainLaneResponse
)
async def drain_sync_lane(lane: str, _current_user: CurrentUser) -> Any:
    """Empty this lane now: archive every message and cancel the jobs behind it.

    Destructive, and gated on `JOBS_MANAGE` for the reason that permission
    already gives for covering `POST /{job_id}/trigger`: triggering retention
    deletes Posts, so this permission is not a read-only one and pausing or
    discarding queued work is the same audience and the same act.
    """
    result = await drain_lane(_known_lane(lane))
    return DrainLaneResponse(
        lane=result.lane,
        archived=result.archived,
        jobsCancelled=result.jobs_cancelled,
    )


def _depth_of(session: Session, lane: str) -> LaneDepth:
    return next(d for d in lane_depths(session) if d.lane == lane)


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
    # Ticket 10: *every* mode enqueues now, one message per Channel, and the
    # worker process is what runs them. Ticket 09 did this for `individual`
    # only and left bulk on `asyncio.create_task`, which meant the API process
    # was still doing the scraping for the heaviest requests — the exact thing
    # a deploy or a restart interrupted. The job row already exists
    # (`create_job` above), so `GET /jobs/sync/{id}/events` sees the same
    # "pending" -> "running" -> terminal sequence it always has.
    await enqueue_sync_job(job, user_uuid)
    return StartSyncJobResponse(jobId=job.job_id)


@router.get("/sync/{job_id}", response_model=SyncJobStatusResponse)
def get_sync_job_status(
    job_id: str, session: SessionDep, current_user: CurrentUser
) -> SyncJobStatusResponse:
    job = _visible_job(get_job(job_id), session, current_user)
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
async def sync_job_events(
    job_id: str, session: SessionDep, current_user: CurrentUser
) -> StreamingResponse:
    job = _visible_job(get_job(job_id), session, current_user)

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
    job_id: str, session: SessionDep, current_user: CurrentUser
) -> CancelSyncJobResponse:
    # Visibility is decided *before* the cancel, not after. `cancel_job` writes
    # a cancellation another process acts on, so checking its return value
    # would mean stopping someone else's sync and then explaining that it could
    # not be found.
    _visible_job(get_job(job_id), session, current_user)
    job = await cancel_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=_JOB_NOT_FOUND)
    return CancelSyncJobResponse(jobId=job.job_id, status=job.status)
