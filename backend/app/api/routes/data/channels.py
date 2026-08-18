"""Channels, their setting groups, and the bulk operations over them.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

import asyncio
import json
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser, SessionDep
from app.api.http_cache import json_response_with_etag
from app.core.config import settings
from app.schemas.channels import (
    BulkChannelTagsResponse,
    BulkReresolveStartIdsResponse,
    BulkResetSyncResponse,
    BulkSettingGroupResponse,
    BulkUpdatedResponse,
    ChannelResponse,
    ChannelStatsResponse,
    ChannelUpsertRequest,
    SyncMetaEntry,
)
from app.schemas.common import StatusResponse
from app.schemas.data import (
    BulkChannelSettingGroupRequest,
    BulkChannelTagsRequest,
    BulkFollowJobStatusResponse,
    BulkFollowRequest,
    BulkFollowStartResponse,
    BulkReresolveStartIdsRequest,
    BulkResetSyncRequest,
    BulkSyncSettingsRequest,
    CancelBulkFollowResponse,
    SettingGroupWriteRequest,
)
from app.schemas.setting_groups import SettingGroupResponse
from app.services.bulk_channels import (
    bulk_reresolve_start_ids,
    bulk_reset_and_queue_sync,
)
from app.services.bulk_follow import (
    cancel_follow_job,
    create_follow_job,
    get_follow_job,
    run_follow_job,
    wait_follow_job_update,
)
from app.services.channel_setting_groups import (
    bulk_assign_setting_group as bulk_assign_setting_group_impl,
)
from app.services.channel_setting_groups import (
    create_setting_group as create_setting_group_impl,
)
from app.services.channel_setting_groups import (
    delete_setting_group as delete_setting_group_impl,
)
from app.services.channel_setting_groups import (
    list_setting_groups as list_setting_groups_impl,
)
from app.services.channel_setting_groups import (
    update_setting_group as update_setting_group_impl,
)
from app.services.channels import (
    bulk_update_channel_tags as bulk_update_channel_tags_impl,
)
from app.services.channels import (
    bulk_update_sync_settings as bulk_update_sync_settings_impl,
)
from app.services.channels import (
    delete_channel as delete_channel_impl,
)
from app.services.channels import (
    get_channel_stats as get_channel_stats_impl,
)
from app.services.channels import (
    list_all_channel_stats,
)
from app.services.channels import (
    list_channel_bios as list_channel_bios_impl,
)
from app.services.channels import (
    list_channels as list_channels_impl,
)
from app.services.channels import (
    upsert_channel as upsert_channel_impl,
)
from app.services.operator import get_operator_user_id
from app.services.sync_meta import get_sync_meta, touch_sync

_TERMINAL_FOLLOW_STATUSES = frozenset({"completed", "failed", "cancelled"})


router = APIRouter()


def _follow_status_changed(
    previous: dict[str, Any] | None, current: dict[str, Any]
) -> bool:
    if previous is None:
        return True
    if previous.get("status") != current.get("status"):
        return True
    if previous.get("syncJobId") != current.get("syncJobId"):
        return True
    prev_results = {r["name"]: r["status"] for r in previous.get("results", [])}
    for r in current.get("results", []):
        if prev_results.get(r["name"]) != r["status"]:
            return True
    return False


@router.get("/sync-meta")
def get_sync_meta_route(
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, SyncMetaEntry]:
    return {
        resource: SyncMetaEntry.model_validate(entry)
        for resource, entry in get_sync_meta(session).items()
    }


@router.get("/channels", response_model=list[ChannelResponse])
def list_channels(
    request: Request,
    session: SessionDep,
    _current_user: CurrentUser,
    include_stats: bool = Query(False, alias="includeStats"),
) -> Response:
    """The channel list, without `bio` — see `list_channel_bios`.

    Returns a hand-built `Response` so the body can be hashed into an `ETag`;
    `response_model` above still drives the OpenAPI schema and the generated
    client. `refetchOnWindowFocus` asks for this list on every window focus, and
    channel rows are quiet minute to minute (0 changed in the last minute, 1 in
    five, on staging), so most of those become a bodiless 304 instead of 494 KB.
    """
    return json_response_with_etag(
        request,
        [
            ChannelResponse.model_validate(row)
            for row in list_channels_impl(session, include_stats=include_stats)
        ],
    )


@router.get("/channels/stats", response_model=dict[str, ChannelStatsResponse])
def list_channel_stats(
    request: Request,
    session: SessionDep,
    _current_user: CurrentUser,
) -> Response:
    """Post aggregates for every channel, keyed by channel name.

    The Channels tab's stats, split off `GET /channels?includeStats=true` so the
    grid can paint without them: they cost 2.36s of a 3.13s response and 46 KB of
    a 536 KB payload, and only two of the grid's eleven sort options read them.

    Declared ahead of every `/channels/{channel_id}` route so a literal "stats"
    can never be captured as a channel id — the same ordering hazard the
    `/discover/reports/latest` and `/settings/network` routes are placed against.
    """
    return json_response_with_etag(
        request,
        {
            name: ChannelStatsResponse.model_validate(stats)
            for name, stats in list_all_channel_stats(session).items()
        },
    )


@router.get("/channels/bios", response_model=dict[str, str])
def list_channel_bios(
    request: Request,
    session: SessionDep,
    _current_user: CurrentUser,
) -> Response:
    """Every channel's bio, keyed by channel name.

    40% of the channel list's gzipped bytes for something the grid clamps to two
    lines on the ~20 cards on screen. Off the critical path here, the grid paints
    from a 297 KB list instead of a 494 KB one.

    Same ordering placement as `/channels/stats`: ahead of `/channels/{id}`.
    """
    return json_response_with_etag(request, list_channel_bios_impl(session))


@router.put("/channels/{channel_id}")
def upsert_channel(
    channel_id: str,
    body: ChannelUpsertRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> ChannelResponse:
    return ChannelResponse.model_validate(
        upsert_channel_impl(
            session, channel_id, body.to_service_body(), user_id=_current_user.id
        )
    )


@router.post("/channels/bulk-follow", response_model=BulkFollowStartResponse)
async def start_bulk_follow(
    body: BulkFollowRequest,
    current_user: CurrentUser,
) -> BulkFollowStartResponse:
    if not body.channels:
        raise HTTPException(status_code=400, detail="channels must not be empty")

    channel_payloads = [
        {
            "name": entry.name,
            "discoveredVia": (
                entry.discovered_via.model_dump(by_alias=True)
                if entry.discovered_via
                else None
            ),
        }
        for entry in body.channels
    ]
    job = await create_follow_job(
        channels=channel_payloads,
        user_id=str(current_user.id) if current_user.id else None,
        proxies=list(body.proxies or []) if body.proxy_enabled else [],
        tor_auto_rotate=body.tor_auto_rotate,
        tor_rotation_threshold=body.tor_rotation_threshold,
    )
    if not job.results:
        raise HTTPException(status_code=400, detail="No valid channel names provided")

    asyncio.create_task(run_follow_job(job))
    return BulkFollowStartResponse(followJobId=job.follow_job_id)


@router.get(
    "/channels/bulk-follow/{follow_job_id}",
    response_model=BulkFollowJobStatusResponse,
)
def get_bulk_follow_status(
    follow_job_id: str, _current_user: CurrentUser
) -> BulkFollowJobStatusResponse:
    job = get_follow_job(follow_job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Follow job not found")
    return BulkFollowJobStatusResponse(**job.to_camel())


@router.get("/channels/bulk-follow/{follow_job_id}/events")
async def bulk_follow_events(
    follow_job_id: str, _current_user: CurrentUser
) -> StreamingResponse:
    job = get_follow_job(follow_job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Follow job not found")

    throttle_ms = settings.SYNC_JOB_SSE_THROTTLE_MS
    throttle_s = max(throttle_ms, 1) / 1000

    async def event_stream() -> AsyncIterator[str]:
        seen_seq = job._update_seq
        last_sent_at = 0.0
        last_snapshot: dict[str, Any] | None = None

        while True:
            current_job = get_follow_job(follow_job_id)
            if current_job is None:
                break

            snapshot = current_job.to_camel()
            now_ms = time.monotonic() * 1000
            status_changed = _follow_status_changed(last_snapshot, snapshot)
            should_send = (
                last_snapshot is None
                or status_changed
                or now_ms - last_sent_at >= throttle_ms
            )

            if should_send:
                yield f"data: {json.dumps(snapshot)}\n\n"
                last_sent_at = now_ms
                last_snapshot = snapshot

            if snapshot["status"] in _TERMINAL_FOLLOW_STATUSES:
                yield "data: [DONE]\n\n"
                return

            seen_seq = await wait_follow_job_update(
                current_job, seen_seq=seen_seq, timeout_s=throttle_s
            )

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post(
    "/channels/bulk-follow/{follow_job_id}/cancel",
    response_model=CancelBulkFollowResponse,
)
async def cancel_bulk_follow(
    follow_job_id: str, _current_user: CurrentUser
) -> CancelBulkFollowResponse:
    job = await cancel_follow_job(follow_job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Follow job not found")
    return CancelBulkFollowResponse(followJobId=job.follow_job_id, status=job.status)


@router.post("/channels/bulk-reresolve-start-ids")
async def bulk_reresolve_start_ids_endpoint(
    session: SessionDep,
    _current_user: CurrentUser,
    body: BulkReresolveStartIdsRequest = Body(
        default_factory=BulkReresolveStartIdsRequest
    ),
) -> BulkReresolveStartIdsResponse:
    operator_id = _current_user.id or get_operator_user_id(session)
    result = await bulk_reresolve_start_ids(
        session,
        operator_id=operator_id,
        dry_run=body.dry_run,
        limit=body.limit,
        channel_ids=body.channel_ids,
        auto_follow_only=body.auto_follow_only,
    )
    return BulkReresolveStartIdsResponse(
        updated=result.updated,
        skipped=result.skipped,
        wouldUpdate=result.would_update,
        errors=result.errors,
        deprecated=result.deprecated,
        message=result.message,
    )


@router.post("/channels/bulk-reset-sync")
async def bulk_reset_sync_endpoint(
    session: SessionDep,
    _current_user: CurrentUser,
    body: BulkResetSyncRequest = Body(...),
) -> BulkResetSyncResponse:
    if not body.confirm:
        raise HTTPException(
            status_code=400,
            detail="Set confirm=true to clear posts and queue sync for selected channels.",
        )
    operator_id = _current_user.id or get_operator_user_id(session)
    result = await bulk_reset_and_queue_sync(
        session,
        operator_id=operator_id,
        channel_ids=body.channel_ids,
        auto_follow_only=body.auto_follow_only,
    )
    return BulkResetSyncResponse(
        channelsReset=result.channels_reset,
        postsDeleted=result.posts_deleted,
        jobId=result.job_id,
        errors=result.errors,
    )


@router.patch("/channels/bulk-sync-settings")
def bulk_sync_settings_endpoint(
    body: BulkSyncSettingsRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> BulkUpdatedResponse:
    return BulkUpdatedResponse.model_validate(
        bulk_update_sync_settings_impl(
            session,
            channel_ids=body.channel_ids,
            regular_sync_enabled=body.regular_sync_enabled,
            dynamic_sync_enabled=body.dynamic_sync_enabled,
            auto_sync_interval_minutes=body.auto_sync_interval_minutes,
            dynamic_sync_expected_posts=body.dynamic_sync_expected_posts,
            operator_id=current_user.id,
        )
    )


@router.get("/setting-groups")
def list_setting_groups(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[SettingGroupResponse]:
    return [
        SettingGroupResponse.model_validate(row)
        for row in list_setting_groups_impl(session, operator_id=current_user.id)
    ]


@router.post("/setting-groups")
def create_setting_group(
    body: SettingGroupWriteRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> SettingGroupResponse:
    result = create_setting_group_impl(
        session,
        body.model_dump(by_alias=False, exclude_none=True),
        user_id=current_user.id,
    )
    touch_sync(session, "channels")
    return SettingGroupResponse.model_validate(result)


@router.put("/setting-groups/{group_id}")
def update_setting_group(
    group_id: str,
    body: SettingGroupWriteRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> SettingGroupResponse:
    result = update_setting_group_impl(
        session,
        group_id,
        body.model_dump(by_alias=False, exclude_none=True),
    )
    touch_sync(session, "channels")
    return SettingGroupResponse.model_validate(result)


@router.delete("/setting-groups/{group_id}")
def delete_setting_group(
    group_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> StatusResponse:
    delete_setting_group_impl(session, group_id)
    touch_sync(session, "channels")
    return StatusResponse(status="deleted")


@router.patch("/channels/bulk-setting-group")
def bulk_assign_setting_group(
    body: BulkChannelSettingGroupRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> BulkSettingGroupResponse:
    result = bulk_assign_setting_group_impl(
        session,
        channel_ids=body.channel_ids,
        setting_group_id=body.setting_group_id,
        operator_id=current_user.id,
    )
    touch_sync(session, "channels")
    return BulkSettingGroupResponse.model_validate(result)


@router.patch("/channels/bulk-tags")
def bulk_channel_tags_endpoint(
    body: BulkChannelTagsRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> BulkChannelTagsResponse:
    return BulkChannelTagsResponse.model_validate(
        bulk_update_channel_tags_impl(
            session,
            updates=[
                {"channel_id": update.channel_id, "tags": update.tags}
                for update in body.updates
            ],
            operator_id=current_user.id,
        )
    )


@router.delete("/channels/{channel_id}")
def delete_channel(
    channel_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> StatusResponse:
    return StatusResponse.model_validate(delete_channel_impl(session, channel_id))


@router.get("/channels/{channel_id}/stats")
def get_channel_stats(
    channel_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> ChannelStatsResponse:
    return ChannelStatsResponse.model_validate(
        get_channel_stats_impl(session, channel_id)
    )
