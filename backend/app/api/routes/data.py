"""CRUD and sync APIs for TG Summarizer data."""

import asyncio
import json
import time
from collections.abc import AsyncIterator
from typing import Any, cast

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pydantic import Field as PydanticField

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.jobs.discover_probe import DISCOVER_PROBE_JOB_ID, is_sweep_running
from app.jobs.settings import (
    is_job_enabled,
    load_jobs_settings,
    load_retention_settings,
    load_sync_settings,
    load_translation_settings,
)
from app.models_tg import AppSetting, utc_now
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
from app.schemas.summaries import (
    SummaryListItemResponse,
    SummaryResponse,
    SummaryUpsertRequest,
)
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
    list_channels as list_channels_impl,
)
from app.services.channels import (
    upsert_channel as upsert_channel_impl,
)
from app.services.credentials import (
    delete_bot_credential as delete_bot_credential_impl,
)
from app.services.credentials import (
    delete_chat_destination as delete_chat_destination_impl,
)
from app.services.credentials import (
    list_bot_credentials as list_bot_credentials_impl,
)
from app.services.credentials import (
    list_chat_destinations as list_chat_destinations_impl,
)
from app.services.credentials import (
    migrate_bot_credentials as migrate_bot_credentials_impl,
)
from app.services.credentials import (
    upsert_bot_credential as upsert_bot_credential_impl,
)
from app.services.credentials import (
    upsert_chat_destination as upsert_chat_destination_impl,
)
from app.services.data_import_export import import_data as import_data_impl
from app.services.data_import_export import stream_export_data
from app.services.data_vectors import (
    DEFAULT_VECTOR_PAGE_SIZE,
    MAX_VECTOR_PAGE_SIZE,
)
from app.services.data_vectors import (
    get_translation as get_translation_impl,
)
from app.services.data_vectors import (
    list_translations as list_translations_impl,
)
from app.services.data_vectors import (
    upsert_embeddings as upsert_embeddings_impl,
)
from app.services.data_vectors import (
    upsert_translations as upsert_translations_impl,
)
from app.services.discover import (
    SIGNAL_KINDS,
    SignalKind,
    compute_discover_candidates,
)
from app.services.discover_ignored import (
    ignore_channels,
    list_ignored,
    unignore_channels,
)
from app.services.discover_probes import (
    DEFAULT_PROBE_PAGE_SIZE,
    MAX_PROBE_PAGE_SIZE,
    list_probes,
    queue_counts,
    requeue_probes,
)
from app.services.discover_reports import (
    DEFAULT_REPORT_PAGE_SIZE,
    MAX_REPORT_PAGE_SIZE,
    create_report,
    delete_report,
    get_report,
    latest_report,
    list_reports,
)
from app.services.logs import (
    DEFAULT_LOG_PAGE_SIZE,
    LOG_MODELS,
    MAX_LOG_PAGE_SIZE,
    clear_logs,
    create_logs,
    delete_log_by_id,
    delete_old_logs,
    list_embedding_logs,
    list_llm_logs,
    list_network_logs,
    list_publish_logs,
    list_sync_logs,
)
from app.services.network_settings import (
    get_network_setting_row,
    merge_network_put,
    network_settings_payload,
)
from app.services.operator import get_operator_user_id
from app.services.post_filters import (
    FORWARDED_FILTERS,
    MEDIA_FILTERS,
    PostFilters,
)
from app.services.posts import (
    DEFAULT_POST_PAGE_SIZE,
    FEED_CAP_MODES,
    FEED_SORTS,
    MAX_POST_LOOKUP_BATCH,
    MAX_POST_PAGE_SIZE,
    bulk_upsert_posts,
)
from app.services.posts import count_posts_in_scope as count_posts_in_scope_impl
from app.services.posts import list_feed as list_feed_impl
from app.services.posts import lookup_posts as lookup_posts_impl
from app.services.settings_store import get_app_setting, put_app_setting
from app.services.stats import clear_table, get_db_stats, get_table_sizes
from app.services.summaries import (
    DEFAULT_SUMMARY_PAGE_SIZE,
    MAX_SUMMARY_PAGE_SIZE,
)
from app.services.summaries import (
    delete_summary as delete_summary_impl,
)
from app.services.summaries import (
    get_summary as get_summary_impl,
)
from app.services.summaries import (
    list_summaries as list_summaries_impl,
)
from app.services.summaries import (
    upsert_summary as upsert_summary_impl,
)
from app.services.sync_meta import get_sync_meta, touch_sync
from app.services.tag_runs import (
    DEFAULT_TAG_RUN_PAGE_SIZE,
    MAX_TAG_RUN_PAGE_SIZE,
)
from app.services.tag_runs import (
    delete_tag_run as delete_tag_run_impl,
)
from app.services.tag_runs import (
    get_tag_run as get_tag_run_impl,
)
from app.services.tag_runs import (
    list_tag_runs as list_tag_runs_impl,
)
from app.services.tag_runs import (
    upsert_tag_run as upsert_tag_run_impl,
)

_SETTING_LOADERS = {
    "jobs": load_jobs_settings,
    "sync": load_sync_settings,
    "retention": load_retention_settings,
    "translation": load_translation_settings,
}

_TERMINAL_FOLLOW_STATUSES = frozenset({"completed", "failed", "cancelled"})

# Tables whose clear removes rows from more than one resource.
CLEARED_SYNC_RESOURCES: dict[str, tuple[str, ...]] = {
    "posts": ("posts", "embeddings", "translations"),
}

router = APIRouter(prefix="/data", tags=["data"])


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
) -> dict[str, Any]:
    return get_sync_meta(session)


@router.get("/channels")
def list_channels(
    session: SessionDep,
    _current_user: CurrentUser,
    include_stats: bool = Query(False, alias="includeStats"),
) -> list[dict[str, Any]]:
    return list_channels_impl(session, include_stats=include_stats)


@router.put("/channels/{channel_id}")
def upsert_channel(
    channel_id: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return upsert_channel_impl(session, channel_id, body, user_id=_current_user.id)


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
) -> dict[str, Any]:
    operator_id = _current_user.id or get_operator_user_id(session)
    result = await bulk_reresolve_start_ids(
        session,
        operator_id=operator_id,
        dry_run=body.dry_run,
        limit=body.limit,
        channel_ids=body.channel_ids,
        auto_follow_only=body.auto_follow_only,
    )
    return {
        "updated": result.updated,
        "skipped": result.skipped,
        "wouldUpdate": result.would_update,
        "errors": result.errors,
        "deprecated": result.deprecated,
        "message": result.message,
    }


@router.post("/channels/bulk-reset-sync")
async def bulk_reset_sync_endpoint(
    session: SessionDep,
    _current_user: CurrentUser,
    body: BulkResetSyncRequest = Body(...),
) -> dict[str, Any]:
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
    return {
        "channelsReset": result.channels_reset,
        "postsDeleted": result.posts_deleted,
        "jobId": result.job_id,
        "errors": result.errors,
    }


@router.patch("/channels/bulk-sync-settings")
def bulk_sync_settings_endpoint(
    body: BulkSyncSettingsRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, int]:
    return bulk_update_sync_settings_impl(
        session,
        channel_ids=body.channel_ids,
        regular_sync_enabled=body.regular_sync_enabled,
        dynamic_sync_enabled=body.dynamic_sync_enabled,
        auto_sync_interval_minutes=body.auto_sync_interval_minutes,
        dynamic_sync_expected_posts=body.dynamic_sync_expected_posts,
        operator_id=current_user.id,
    )


@router.get("/setting-groups")
def list_setting_groups(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_setting_groups_impl(session, operator_id=current_user.id)


@router.post("/setting-groups")
def create_setting_group(
    body: SettingGroupWriteRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    result = create_setting_group_impl(
        session,
        body.model_dump(by_alias=False, exclude_none=True),
        user_id=current_user.id,
    )
    touch_sync(session, "channels")
    return result


@router.put("/setting-groups/{group_id}")
def update_setting_group(
    group_id: str,
    body: SettingGroupWriteRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    result = update_setting_group_impl(
        session,
        group_id,
        body.model_dump(by_alias=False, exclude_none=True),
    )
    touch_sync(session, "channels")
    return result


@router.delete("/setting-groups/{group_id}")
def delete_setting_group(
    group_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, str]:
    result = delete_setting_group_impl(session, group_id)
    touch_sync(session, "channels")
    return result


@router.patch("/channels/bulk-setting-group")
def bulk_assign_setting_group(
    body: BulkChannelSettingGroupRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    result = bulk_assign_setting_group_impl(
        session,
        channel_ids=body.channel_ids,
        setting_group_id=body.setting_group_id,
        operator_id=current_user.id,
    )
    touch_sync(session, "channels")
    return result


@router.patch("/channels/bulk-tags")
def bulk_channel_tags_endpoint(
    body: BulkChannelTagsRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    return bulk_update_channel_tags_impl(
        session,
        updates=[
            {"channel_id": update.channel_id, "tags": update.tags}
            for update in body.updates
        ],
        operator_id=current_user.id,
    )


@router.delete("/channels/{channel_id}")
def delete_channel(
    channel_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, str]:
    return delete_channel_impl(session, channel_id)


@router.get("/channels/{channel_id}/stats")
def get_channel_stats(
    channel_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return get_channel_stats_impl(session, channel_id)


class PostScopeRequest(BaseModel):
    """A post scope carried in a request body rather than a query string.

    The channel selection can run to the full account — over a thousand handles —
    which as `?channelNames=a,b,c,...` produced URLs long enough to hit proxy and
    server header limits. A body has no such ceiling.
    """

    channel_names: list[str] | None = PydanticField(None, alias="channelNames")
    start_date: int | None = PydanticField(None, alias="startDate")
    end_date: int | None = PydanticField(None, alias="endDate")
    keyword: str | None = None
    forwarded: str = "all"
    media: str = "all"
    max_per_channel: int = PydanticField(0, alias="maxPerChannel", ge=0)

    def cleaned_channel_names(self) -> list[str] | None:
        """Non-empty, trimmed handles — matching the old comma-split behaviour."""
        if self.channel_names is None:
            return None
        names = [n.strip() for n in self.channel_names if n.strip()]
        return names or None


class PostFeedRequest(PostScopeRequest):
    """`PostScopeRequest` plus the feed's paging, cap mode and sort.

    `limit`/`offset` keep the same bounds the query params enforced, so an
    out-of-range page is still a 422 rather than an unbounded read.
    """

    channel_name: str | None = PydanticField(None, alias="channelName")
    limit: int = PydanticField(DEFAULT_POST_PAGE_SIZE, ge=1, le=MAX_POST_PAGE_SIZE)
    offset: int = PydanticField(0, ge=0)
    max_per_channel_mode: str = PydanticField("latest", alias="maxPerChannelMode")
    sort: str = "time"
    seed: int = 0

    def resolved_channel_names(self) -> list[str] | None:
        """`channelNames` wins; `channelName` is the single-channel shorthand.

        Mirrors the old `if channel_names: ... elif channel_name: ...`, including
        that an empty `channelNames` falls through to the singular form.
        """
        names = self.cleaned_channel_names()
        if names:
            return names
        if self.channel_name and self.channel_name.strip():
            return [self.channel_name.strip()]
        return None


class DiscoverPostRef(BaseModel):
    channel_name: str = PydanticField(alias="channelName")
    post_id: int = PydanticField(alias="postId")


class DiscoverCandidatesRequest(PostScopeRequest):
    """`PostScopeRequest` plus the signal-kind filter and the cap/scope inputs.

    `channelNames` is re-declared as required: the discovery aggregate is always
    asked about an explicit selection, and the query-string version required it
    too.

    `maxPerChannelMode`/`seed` and `postIds` are what let Discover reproduce the
    two scopes that used to fall back to a second, client-side implementation of
    the same counting rules — the `random` cap and a semantic query
    (IDEA-011 D14).
    """

    channel_names: list[str] = PydanticField(alias="channelNames")
    signals: list[str] | None = None
    max_per_channel_mode: str = PydanticField("latest", alias="maxPerChannelMode")
    seed: int = 0
    post_ids: list[DiscoverPostRef] | None = PydanticField(None, alias="postIds")

    def resolved_post_ids(self) -> list[tuple[str, int]] | None:
        """`None` means "no restriction"; `[]` means "matched nothing"."""
        if self.post_ids is None:
            return None
        return [(ref.channel_name, ref.post_id) for ref in self.post_ids]


@router.post("/posts")
def list_posts(
    body: PostFeedRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    """One page of posts for a channel/date scope.

    With no filters, no cap and ``sort=time`` this is the newest-first page the
    export/lookup fallbacks and language detection rely on. The Posts feed also
    passes keyword/forwarded/media filters, a per-channel cap, a sort order and
    ``offset`` so the whole view is assembled server-side instead of paging a
    channel's history into the browser.

    POST rather than GET because the scope carries the channel selection, which
    can be the entire account — see `PostScopeRequest`. This is a read expressed
    as a POST purely so the selection travels in the body.
    """
    if body.sort not in FEED_SORTS:
        raise HTTPException(status_code=422, detail=f"unknown sort: {body.sort}")
    if body.max_per_channel_mode not in FEED_CAP_MODES:
        raise HTTPException(
            status_code=422,
            detail=f"unknown maxPerChannelMode: {body.max_per_channel_mode}",
        )
    return list_feed_impl(
        session,
        channel_names=body.resolved_channel_names(),
        start_date=body.start_date,
        end_date=body.end_date,
        filters=_parse_post_filters(body.keyword, body.forwarded, body.media),
        max_per_channel=body.max_per_channel,
        max_per_channel_mode=body.max_per_channel_mode,
        sort=body.sort,
        seed=body.seed,
        limit=body.limit,
        offset=body.offset,
    )


def _parse_post_filters(keyword: str | None, forwarded: str, media: str) -> PostFilters:
    """Validate the shared Posts-tab filter query params into a PostFilters.

    Rejecting unknown enum values with 422 mirrors how the frontend can only
    ever send its own filter constants.
    """
    if forwarded not in FORWARDED_FILTERS:
        raise HTTPException(status_code=422, detail=f"unknown forwarded: {forwarded}")
    if media not in MEDIA_FILTERS:
        raise HTTPException(status_code=422, detail=f"unknown media: {media}")
    return PostFilters(
        keyword=keyword,
        forwarded=cast("Any", forwarded),
        media=cast("Any", media),
    )


@router.post("/discover/candidates")
def discover_candidates(
    body: DiscoverCandidatesRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    """Aggregated discovery candidates for a channel/date scope.

    Returns counts only. The client previously fetched every post body in
    scope to compute this in JS. The keyword/forwarded/media/cap params
    reproduce the Posts-tab view the client aggregated over, and
    `maxPerChannelMode`/`seed`/`postIds` cover the `random` cap and semantic
    scopes that used to keep a second client-side implementation alive.

    POST rather than GET for the same reason as `/posts` — the channel selection
    travels in the body so it cannot overflow the request line.
    """
    return compute_discover_candidates(session, **_discover_kwargs(body))


def _parse_discover_signals(signals: list[str] | None) -> set[str] | None:
    """Validate signal kinds, shared by the stateless and saved-report routes."""
    kinds = {s.strip() for s in signals if s.strip()} if signals is not None else None
    unknown = kinds - set(SIGNAL_KINDS) if kinds else set()
    if unknown:
        raise HTTPException(
            status_code=422, detail=f"unknown signal(s): {sorted(unknown)}"
        )
    return kinds


def _discover_kwargs(body: DiscoverCandidatesRequest) -> dict[str, Any]:
    """Validated aggregation inputs, shared by the compute and save routes.

    Both routes must interpret an identical request identically — a report is
    just a persisted version of the same aggregate — so the parsing lives here
    rather than being duplicated per route.
    """
    if body.max_per_channel_mode not in FEED_CAP_MODES:
        raise HTTPException(
            status_code=422,
            detail=f"unknown maxPerChannelMode: {body.max_per_channel_mode}",
        )
    return {
        "channel_names": [n.strip() for n in body.channel_names if n.strip()],
        "start_date": body.start_date,
        "end_date": body.end_date,
        "signals": cast(
            "set[SignalKind] | None", _parse_discover_signals(body.signals)
        ),
        "filters": _parse_post_filters(body.keyword, body.forwarded, body.media),
        "max_per_channel": body.max_per_channel,
        "max_per_channel_mode": body.max_per_channel_mode,
        "seed": body.seed,
        "post_ids": body.resolved_post_ids(),
    }


class DiscoverIgnoreRequest(BaseModel):
    handles: list[str]
    reason: str | None = None


@router.get("/discover/ignored")
def list_discover_ignored(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    """Dismissed candidates, newest first."""
    return list_ignored(session)


@router.post("/discover/ignored")
def add_discover_ignored(
    body: DiscoverIgnoreRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    """Dismiss candidates so later reports stop re-surfacing them.

    Idempotent: re-dismissing an entry is a no-op rather than an error, since
    the UI treats this as a toggle.
    """
    added = ignore_channels(
        session, body.handles, reason=body.reason, user_id=_current_user.id
    )
    return {"ignored": added}


@router.delete("/discover/ignored")
def remove_discover_ignored(
    body: DiscoverIgnoreRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    """Undo a dismissal.

    DELETE with a body rather than a path param so a batch can be undone in one
    call, matching the POST.
    """
    return {"removed": unignore_channels(session, body.handles)}


class DiscoverProbeRequest(BaseModel):
    handles: list[str]


@router.get("/discover/probes")
def list_discover_probes(
    session: SessionDep,
    _current_user: CurrentUser,
    status: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_PROBE_PAGE_SIZE, ge=1, le=MAX_PROBE_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    """One page of cached handle probes, optionally filtered by status."""
    return list_probes(session, status=status, limit=limit, offset=offset)


@router.get("/discover/probe/queue")
def get_discover_probe_queue(
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    """Probe queue state, for the progress display.

    There is no job id to poll: probing is a scheduled backend job draining a
    durable queue (`app.jobs.discover_probe`), not something a client starts.
    Everything the UI needs is a count, and the verdicts themselves arrive
    through the report read, which already joins the probe table.

    `enabled` reflects the operator's pause switch — the ordinary job toggle, so
    pausing is durable and every open tab agrees about it.
    """
    counts = queue_counts(session)
    return {
        **counts,
        "enabled": is_job_enabled(session, DISCOVER_PROBE_JOB_ID),
        "running": is_sweep_running(),
    }


@router.post("/discover/probe/recheck")
def recheck_discover_probes(
    body: DiscoverProbeRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    """Discard cached verdicts for these handles and put them back in the queue.

    The escape hatch for a verdict that is wrong or has gone stale: a private
    channel that opened up, or a handle misjudged during an outage. Without it,
    caching indefinitely would mean a single bad answer is permanent.

    Requeues at the front rather than merely forgetting. A row is both the cached
    answer and the work item, so deleting it would drop the handle out of the
    queue and nothing would fetch it again. The next drain tick picks these up
    first, so the wait is bounded by the job interval.
    """
    return {"requeued": requeue_probes(session, body.handles)}


@router.post("/discover/reports")
def create_discover_report(
    body: DiscoverCandidatesRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    """Generate a Discover report and save it.

    Unlike `/discover/candidates`, which computes and forgets, this persists the
    result together with a snapshot of the scope it was generated for. The saved
    report is immutable: later changes to the channel selection or the Posts-tab
    filters produce a *new* report rather than altering this one (IDEA-011 W1).
    """
    return create_report(session, user_id=_current_user.id, **_discover_kwargs(body))


@router.get("/discover/reports")
def list_discover_reports(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_REPORT_PAGE_SIZE, ge=1, le=MAX_REPORT_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    """Newest-first page of saved reports, without their candidate rows.

    See `report_to_camel_light`: a wide-scope report holds the full
    single-reference tail, so the list ships a `candidateCount` instead.
    """
    return list_reports(session, limit=limit, offset=offset, search=search)


@router.get("/discover/reports/latest")
def get_latest_discover_report(
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any] | None:
    """The most recent saved report, or null if none exists yet.

    Declared before `/discover/reports/{report_id}` so "latest" is not captured
    as an id by the path parameter.
    """
    return latest_report(session)


@router.get("/discover/reports/{report_id}")
def get_discover_report(
    report_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    """A saved report with every candidate, `isFollowed` resolved live."""
    return get_report(session, report_id)


@router.delete("/discover/reports/{report_id}")
def delete_discover_report(
    report_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, str]:
    delete_report(session, report_id)
    return {"status": "deleted"}


@router.post("/posts/counts")
def posts_counts(
    body: PostScopeRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    """Per-channel post counts for a filtered scope, computed as a SQL GROUP BY.

    Replaces the client's `buildPostsInScopeCounts`, which counted the fully
    fetched, client-filtered post array.

    POST rather than GET because the scope carries the channel selection: this is
    a read expressed as a POST purely so the selection travels in the body.
    """
    return count_posts_in_scope_impl(
        session,
        channel_names=body.cleaned_channel_names(),
        start_date=body.start_date,
        end_date=body.end_date,
        filters=_parse_post_filters(body.keyword, body.forwarded, body.media),
        max_per_channel=body.max_per_channel,
    )


class PostLookupRef(BaseModel):
    channel_name: str = PydanticField(alias="channelName")
    post_id: int = PydanticField(alias="postId")


class PostLookupRequest(BaseModel):
    """Batch of `(channelName, postId)` refs to resolve.

    Capped so this cannot become another way to ask for unbounded rows.
    """

    posts: list[PostLookupRef] = PydanticField(max_length=MAX_POST_LOOKUP_BATCH)


@router.post("/posts/lookup")
def lookup_posts_route(
    body: PostLookupRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return lookup_posts_impl(
        session, [(ref.channel_name, ref.post_id) for ref in body.posts]
    )


@router.post("/posts/bulk")
def bulk_upsert_posts_route(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return bulk_upsert_posts(session, body)


@router.get("/summaries")
def list_summaries(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(
        default=DEFAULT_SUMMARY_PAGE_SIZE, ge=1, le=MAX_SUMMARY_PAGE_SIZE
    ),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None),
) -> list[SummaryListItemResponse]:
    """List in the light projection — see `summary_to_camel_light`.

    `search` matches channels/text/promptText/model/note in SQL, so prompt
    bodies stay searchable without being shipped to the client.
    """
    return [
        SummaryListItemResponse.model_validate(row)
        for row in list_summaries_impl(
            session, limit=limit, offset=offset, search=search
        )
    ]


@router.get("/summaries/{summary_id}")
def get_summary(
    summary_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> SummaryResponse:
    """Full summary including citedPosts/promptText/chatMessages."""
    return SummaryResponse.model_validate(get_summary_impl(session, summary_id))


@router.put("/summaries/{summary_id}")
def upsert_summary(
    summary_id: str,
    body: SummaryUpsertRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> SummaryResponse:
    result = upsert_summary_impl(
        session, summary_id, body.to_service_body(), user_id=_current_user.id
    )
    touch_sync(session, "summaries")
    return SummaryResponse.model_validate(result)


@router.delete("/summaries/{summary_id}")
def delete_summary(
    summary_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> StatusResponse:
    delete_summary_impl(session, summary_id)
    touch_sync(session, "summaries")
    return StatusResponse(status="deleted")


@router.get("/tag-runs")
def list_tag_runs(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(
        default=DEFAULT_TAG_RUN_PAGE_SIZE, ge=1, le=MAX_TAG_RUN_PAGE_SIZE
    ),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    """List runs in the light projection — see `tag_run_to_camel_light`."""
    return list_tag_runs_impl(session, limit=limit, offset=offset)


@router.get("/tag-runs/{tag_run_id}")
def get_tag_run(
    tag_run_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    """Full run including promptText/responseText/suggestions."""
    return get_tag_run_impl(session, tag_run_id)


@router.put("/tag-runs/{tag_run_id}")
def upsert_tag_run(
    tag_run_id: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    result = upsert_tag_run_impl(session, tag_run_id, body, user_id=_current_user.id)
    touch_sync(session, "tag_runs")
    return result


@router.delete("/tag-runs/{tag_run_id}")
def delete_tag_run(
    tag_run_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, str]:
    delete_tag_run_impl(session, tag_run_id)
    touch_sync(session, "tag_runs")
    return {"status": "deleted"}


@router.get("/bot-credentials")
def list_bot_credentials(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_bot_credentials_impl(session)


@router.put("/bot-credentials/{bot_id}")
def upsert_bot_credential(
    bot_id: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return upsert_bot_credential_impl(session, bot_id, body, user_id=_current_user.id)


@router.delete("/bot-credentials/{bot_id}")
def delete_bot_credential(
    bot_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, str]:
    return delete_bot_credential_impl(session, bot_id)


@router.post("/bot-credentials/migrate")
def migrate_bot_credentials(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return migrate_bot_credentials_impl(session, body, user_id=_current_user.id)


@router.get("/chat-destinations")
def list_chat_destinations(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_chat_destinations_impl(session)


@router.put("/chat-destinations/{dest_id}")
def upsert_chat_destination(
    dest_id: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return upsert_chat_destination_impl(
        session, dest_id, body, user_id=_current_user.id
    )


@router.delete("/chat-destinations/{dest_id}")
def delete_chat_destination(
    dest_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, str]:
    return delete_chat_destination_impl(session, dest_id)


@router.post("/embeddings")
def upsert_embeddings(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return upsert_embeddings_impl(session, body)


@router.get("/translations/one")
def get_translation(
    session: SessionDep,
    _current_user: CurrentUser,
    channel_name: str = Query(alias="channelName"),
    post_id: int = Query(alias="postId"),
    language: str = Query(),
) -> dict[str, Any] | None:
    """Read a single translation. Returns null when absent."""
    return get_translation_impl(
        session, channel_name=channel_name, post_id=post_id, language=language
    )


@router.get("/translations")
def list_translations(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_VECTOR_PAGE_SIZE, ge=1, le=MAX_VECTOR_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    return list_translations_impl(session, limit=limit, offset=offset)


@router.post("/translations")
def upsert_translations(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return upsert_translations_impl(session, body)


@router.get("/publish-logs")
def list_publish_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_LOG_PAGE_SIZE, ge=1, le=MAX_LOG_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    return list_publish_logs(session, limit=limit, offset=offset)


@router.post("/publish-logs")
def create_publish_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return create_logs(session, "publish", body, user_id=_current_user.id)


@router.get("/sync-logs")
def list_sync_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_LOG_PAGE_SIZE, ge=1, le=MAX_LOG_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    return list_sync_logs(session, limit=limit, offset=offset)


@router.post("/sync-logs")
def create_sync_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return create_logs(session, "sync", body, user_id=_current_user.id)


@router.get("/llm-logs")
def list_llm_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_LOG_PAGE_SIZE, ge=1, le=MAX_LOG_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    return list_llm_logs(session, limit=limit, offset=offset)


@router.post("/llm-logs")
def create_llm_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return create_logs(session, "llm", body, user_id=_current_user.id)


@router.get("/embedding-logs")
def list_embedding_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_LOG_PAGE_SIZE, ge=1, le=MAX_LOG_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any] | list[dict[str, Any]]:
    return list_embedding_logs(session, limit=limit, offset=offset)


@router.post("/embedding-logs")
def create_embedding_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return create_logs(session, "embedding", body, user_id=_current_user.id)


@router.get("/network-logs")
def list_network_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_LOG_PAGE_SIZE, ge=1, le=MAX_LOG_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    return list_network_logs(session, limit=limit, offset=offset)


@router.post("/network-logs")
def create_network_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return create_logs(session, "network", body, user_id=_current_user.id)


@router.get("/stats")
def db_stats(
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return get_db_stats(session, operator_id=_current_user.id)


@router.get("/table-sizes")
def table_sizes(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return get_table_sizes(session, operator_id=_current_user.id)


@router.delete("/tables/{name}")
def clear_table_route(
    name: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    try:
        deleted = clear_table(session, name, operator_id=_current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if deleted:
        # Clearing posts cascades (see clear_table), so refresh the etags of
        # the dependent resources too or their caches would serve rows the
        # database no longer has.
        for resource in CLEARED_SYNC_RESOURCES.get(name, (name,)):
            touch_sync(session, resource)
    return {"deleted": deleted}


@router.delete("/logs")
def purge_logs(
    session: SessionDep,
    _current_user: CurrentUser,
    older_than_days: int | None = Query(default=None, alias="olderThanDays"),
    log_type: str | None = Query(default=None, alias="type"),
    log_id: str | None = Query(default=None, alias="logId"),
    clear_all: bool = Query(default=False, alias="clearAll"),
) -> dict[str, Any]:
    if older_than_days is not None and older_than_days > 0:
        deleted = delete_old_logs(
            session, older_than_days, operator_id=_current_user.id
        )
        for resource in {LOG_MODELS[k][1] for k in deleted if deleted[k]}:
            touch_sync(session, resource)
        return {"deleted": deleted, "total": sum(deleted.values())}

    if log_type is None:
        raise HTTPException(
            status_code=400,
            detail="Provide olderThanDays, or type with logId/clearAll",
        )
    if log_type not in LOG_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown log type: {log_type}")

    resource = LOG_MODELS[log_type][1]
    if log_id:
        if not delete_log_by_id(session, log_type, log_id):
            raise HTTPException(status_code=404, detail="Log entry not found")
        touch_sync(session, resource)
        return {"deleted": 1}

    if clear_all:
        count = clear_logs(session, log_type)
        if count:
            touch_sync(session, resource)
        return {"deleted": count}

    raise HTTPException(
        status_code=400,
        detail="Provide logId or clearAll=true with type",
    )


@router.get("/settings/network")
def get_network_settings(
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    row = get_network_setting_row(session)
    value = network_settings_payload(
        row.value if row else None,
        owner_user_id=row.user_id if row else _current_user.id,
    )
    return {"key": "network", "value": value}


@router.put("/settings/network")
def put_network_settings(
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    row = get_network_setting_row(session)
    merged = merge_network_put(body, row.value if row else None)
    if row:
        row.value = merged
        row.user_id = _current_user.id
        row.updated_at = utc_now()
    else:
        row = AppSetting(key="network", value=merged, user_id=_current_user.id)
    session.add(row)
    session.commit()
    touch_sync(session, "settings")
    return {
        "key": "network",
        "value": network_settings_payload(merged, owner_user_id=_current_user.id),
    }


@router.get("/settings/{key}")
def get_setting(
    key: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    loader = _SETTING_LOADERS.get(key)
    if loader is not None:
        return {"key": key, "value": loader(session)}
    return get_app_setting(session, key)


@router.put("/settings/{key}")
def put_setting(
    key: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    result = put_app_setting(session, key, body, user_id=_current_user.id)
    touch_sync(session, "settings")
    return result


@router.post("/import")
def import_data(
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return import_data_impl(session, body, user_id=_current_user.id)


@router.get("/export")
def export_data(
    session: SessionDep,
    _current_user: CurrentUser,
) -> StreamingResponse:
    """Full export — never truncated.

    Streamed rather than built in memory: the payload spans every post and log
    row, which is far more than a worker can hold at once.
    """
    return StreamingResponse(
        stream_export_data(session),
        media_type="application/json",
    )
