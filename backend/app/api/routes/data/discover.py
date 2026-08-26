"""Discover: candidate aggregation, dismissals, handle probes, reports.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

from typing import Any, cast

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import CurrentUser, SessionDep
from app.api.routes.data._shared import parse_post_filters
from app.jobs.discover_probe import DISCOVER_PROBE_JOB_ID, is_sweep_running
from app.jobs.settings import (
    is_job_enabled,
)
from app.schemas.common import StatusResponse
from app.schemas.discover import (
    DiscoverCandidatesRequest,
    DiscoverCandidatesResponse,
    DiscoverIgnoredAddedResponse,
    DiscoverIgnoredRemovedResponse,
    DiscoverIgnoreRequest,
    DiscoverProbeQueueResponse,
    DiscoverProbeRecheckResponse,
    DiscoverProbeRequest,
    DiscoverReportFlagsRequest,
    DiscoverReportListItemResponse,
    DiscoverReportResponse,
    HandleProbeResponse,
    IgnoredChannelResponse,
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
    list_reports,
    update_report_flags,
)
from app.services.posts import (
    FEED_CAP_MODES,
)

router = APIRouter()


@router.post("/discover/candidates")
def discover_candidates(
    body: DiscoverCandidatesRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> DiscoverCandidatesResponse:
    """Aggregated discovery candidates for a channel/date scope.

    Returns counts only. The client previously fetched every post body in
    scope to compute this in JS. The keyword/forwarded/media/cap params
    reproduce the Posts-tab view the client aggregated over, and
    `maxPerChannelMode`/`seed`/`postIds` cover the `random` cap and semantic
    scopes that used to keep a second client-side implementation alive.

    POST rather than GET for the same reason as `/posts` — the channel selection
    travels in the body so it cannot overflow the request line.
    """
    return DiscoverCandidatesResponse.model_validate(
        compute_discover_candidates(
            session, user_id=current_user.id, **_discover_kwargs(body)
        )
    )


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
        "filters": parse_post_filters(body.keyword, body.forwarded, body.media),
        "max_per_channel": body.max_per_channel,
        "max_per_channel_mode": body.max_per_channel_mode,
        "seed": body.seed,
        "post_ids": body.resolved_post_ids(),
    }


@router.get("/discover/ignored")
def list_discover_ignored(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[IgnoredChannelResponse]:
    """Dismissed candidates, newest first."""
    return [
        IgnoredChannelResponse.model_validate(row)
        for row in list_ignored(session, user_id=_current_user.id)
    ]


@router.post("/discover/ignored")
def add_discover_ignored(
    body: DiscoverIgnoreRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> DiscoverIgnoredAddedResponse:
    """Dismiss candidates so later reports stop re-surfacing them.

    Idempotent: re-dismissing an entry is a no-op rather than an error, since
    the UI treats this as a toggle.
    """
    added = ignore_channels(
        session, body.handles, reason=body.reason, user_id=_current_user.id
    )
    return DiscoverIgnoredAddedResponse(ignored=added)


@router.delete("/discover/ignored")
def remove_discover_ignored(
    body: DiscoverIgnoreRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> DiscoverIgnoredRemovedResponse:
    """Undo a dismissal.

    DELETE with a body rather than a path param so a batch can be undone in one
    call, matching the POST.
    """
    return DiscoverIgnoredRemovedResponse(
        removed=unignore_channels(session, body.handles, user_id=_current_user.id)
    )


@router.get("/discover/probes")
def list_discover_probes(
    session: SessionDep,
    _current_user: CurrentUser,
    status: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_PROBE_PAGE_SIZE, ge=1, le=MAX_PROBE_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[HandleProbeResponse]:
    """One page of cached handle probes, optionally filtered by status."""
    return [
        HandleProbeResponse.model_validate(row)
        for row in list_probes(session, status=status, limit=limit, offset=offset)
    ]


@router.get("/discover/probe/queue")
def get_discover_probe_queue(
    session: SessionDep,
    _current_user: CurrentUser,
) -> DiscoverProbeQueueResponse:
    """Probe queue state, for the progress display.

    There is no job id to poll: probing is a scheduled backend job draining a
    durable queue (`app.jobs.discover_probe`), not something a client starts.
    Everything the UI needs is a count, and the verdicts themselves arrive
    through the report read, which already joins the probe table.

    `enabled` reflects the operator's pause switch — the ordinary job toggle, so
    pausing is durable and every open tab agrees about it.
    """
    counts = queue_counts(session)
    return DiscoverProbeQueueResponse(
        **counts,
        enabled=is_job_enabled(session, DISCOVER_PROBE_JOB_ID),
        running=is_sweep_running(),
    )


@router.post("/discover/probe/recheck")
def recheck_discover_probes(
    body: DiscoverProbeRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> DiscoverProbeRecheckResponse:
    """Discard cached verdicts for these handles and put them back in the queue.

    The escape hatch for a verdict that is wrong or has gone stale: a private
    channel that opened up, or a handle misjudged during an outage. Without it,
    caching indefinitely would mean a single bad answer is permanent.

    Requeues at the front rather than merely forgetting. A row is both the cached
    answer and the work item, so deleting it would drop the handle out of the
    queue and nothing would fetch it again. The next drain tick picks these up
    first, so the wait is bounded by the job interval.
    """
    return DiscoverProbeRecheckResponse(requeued=requeue_probes(session, body.handles))


@router.post("/discover/reports")
def create_discover_report(
    body: DiscoverCandidatesRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> DiscoverReportResponse:
    """Generate a Discover report and save it.

    Unlike `/discover/candidates`, which computes and forgets, this persists the
    result together with a snapshot of the scope it was generated for. The saved
    report is immutable: later changes to the channel selection or the Posts-tab
    filters produce a *new* report rather than altering this one (IDEA-011 W1).
    """
    return DiscoverReportResponse.model_validate(
        create_report(session, user_id=_current_user.id, **_discover_kwargs(body))
    )


@router.get("/discover/reports")
def list_discover_reports(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_REPORT_PAGE_SIZE, ge=1, le=MAX_REPORT_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None),
) -> list[DiscoverReportListItemResponse]:
    """Newest-first page of saved reports, without their candidate rows.

    See `report_to_camel_light`: a wide-scope report holds the full
    single-reference tail, so the list ships a `candidateCount` instead.
    """
    return [
        DiscoverReportListItemResponse.model_validate(row)
        for row in list_reports(
            session,
            limit=limit,
            offset=offset,
            search=search,
            user_id=current_user.id,
        )
    ]


@router.get("/discover/reports/{report_id}")
def get_discover_report(
    report_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> DiscoverReportResponse:
    """A saved report with every candidate, `isFollowed` resolved live."""
    return DiscoverReportResponse.model_validate(
        get_report(session, report_id, user_id=current_user.id)
    )


@router.put("/discover/reports/{report_id}/flags")
def update_discover_report_flags(
    report_id: str,
    body: DiscoverReportFlagsRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> DiscoverReportResponse:
    """Star or annotate a saved report — the only write it accepts."""
    return DiscoverReportResponse.model_validate(
        update_report_flags(
            session, report_id, body.to_service_body(), user_id=current_user.id
        )
    )


@router.delete("/discover/reports/{report_id}")
def delete_discover_report(
    report_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> StatusResponse:
    delete_report(session, report_id, user_id=current_user.id)
    return StatusResponse(status="deleted")
