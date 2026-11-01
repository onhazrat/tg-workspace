"""The posts feed, its scope counts, and bulk post writes.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

from typing import Any

from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.api.post_views import view_of
from app.schemas.posts import (
    BulkUpsertPostsResponse,
    PostCountsResponse,
    PostFacetCount,
    PostFacetsRequest,
    PostFacetsResponse,
    PostFeedRequest,
    PostFilteredRequest,
    PostLookupRequest,
    PostValueHistogramRequest,
    PostValueHistogramResponse,
    PostWindowHistogramRequest,
    PostWindowHistogramResponse,
    SelectablePostResponse,
    ViewCurveResponse,
    ViewEstimateResponse,
)
from app.schemas.window_check import WindowCheckRequest, WindowCheckResponse
from app.services import posts_view
from app.services.analysis_window import resolve_analysis_window
from app.services.posts import bulk_upsert_posts
from app.services.settling_curve import current_estimate
from app.services.window_check import check_window, frozen_moment

router = APIRouter()


@router.post("/posts")
def list_posts(
    body: PostFeedRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[SelectablePostResponse]:
    """One page of posts for a channel/date scope.

    With no filter, no cap and ``sort=newest`` this is the newest-first page the
    export/lookup fallbacks and language detection rely on. The Posts feed also
    passes the keyword, the Post filter, a per-channel cap, a sort order and
    ``offset`` so the whole view is assembled server-side instead of paging a
    channel's history into the browser.

    POST rather than GET because the scope carries the channel selection, which
    can be the entire account — see `PostScopeRequest`. This is a read expressed
    as a POST purely so the selection travels in the body.

    Each post says whether the Post selection selects it. ``selectedFirst``
    lists the selected Posts before the rest, and ``onlySelected`` returns only
    the selected Posts the filter shows.
    """
    return [
        SelectablePostResponse.model_validate(row)
        for row in posts_view.feed(
            session,
            view_of(session, current_user.id, body),
            limit=body.limit,
            offset=body.offset,
            group_by_channel=body.group_by_channel,
            only_selected=body.only_selected,
            selected_first=body.selected_first,
        )
    ]


@router.post("/posts/counts")
def posts_counts(
    body: PostFilteredRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> PostCountsResponse:
    """Per-channel post counts for a filtered scope, computed as a SQL GROUP BY.

    Replaces the client's `buildPostsInScopeCounts`, which counted the fully
    fetched, client-filtered post array. Also says how many Posts an Estimated
    views bound hid for being too new to judge, how many Posts in the window
    the Post selection selects, filters aside, and how many of the Posts the
    filter shows it selects.

    POST rather than GET because the scope carries the channel selection: this is
    a read expressed as a POST purely so the selection travels in the body.
    """
    counted = posts_view.counts(session, view_of(session, current_user.id, body))
    return PostCountsResponse(
        counts=counted["counts"],
        selected=counted["selected"],
        selectedShown=counted["selected_shown"],
        tooNewToJudge=counted["too_new"],
    )


# PTI-01, zoomed by TB-04. A read expressed as a POST for the reason
# `posts_counts` is one, and on `VIEW_AS_READ_ONLY_PATHS` beside it.
@router.post("/posts/value-histogram")
def posts_value_histogram(
    body: PostValueHistogramRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> PostValueHistogramResponse:
    """One measure's bars over the window and the Channels.

    What a number filter's editor draws: 32 bars from the lowest value to the
    highest, logarithmic when the highest is over 100 times the lowest.
    `views` and `estimated` count Posts, `channel_posts` and
    `channel_posts_filtered` count Channels by their Posts in the window. The
    Post filter and the keyword in the body are applied only by
    `channel_posts_filtered`, whose count is the Posts they keep, so the
    other bars hold still while the Account changes another Condition.
    """
    view = view_of(
        session, current_user.id, body, with_estimate=body.measure == "estimated"
    )
    histogram = posts_view.value_histogram(
        session, view, body.measure, zoom=body.zoom, log=body.log
    )
    return PostValueHistogramResponse.model_validate(histogram, from_attributes=True)


# PTI-03. A read expressed as a POST for the reason `posts_counts` is one, and
# on `VIEW_AS_READ_ONLY_PATHS` beside it.
@router.post("/posts/window-histogram")
def posts_window_histogram(
    body: PostWindowHistogramRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> PostWindowHistogramResponse:
    """How many Posts fall in each equal slice of a stretch of time.

    What the Analysis window editor's chart draws. Filtered, the Post filter
    and keyword apply but the per-Channel cap does not, so the bars do not
    depend on the feed's order; `unfiltered` counts every Post of the
    selected Channels. A Channel posts Condition counts within the Analysis
    window, not the stretch drawn.
    """
    return PostWindowHistogramResponse(
        counts=posts_view.window_histogram(
            session,
            view_of(session, current_user.id, body),
            extent_start=body.extent_start,
            extent_end=body.extent_end,
            buckets=body.buckets,
            unfiltered=body.unfiltered,
        )
    )


# PFB-03. A GET: it reads the curve and two settings, nothing per account.
@router.get("/posts/view-estimate")
def posts_view_estimate(
    session: SessionDep, _current_user: CurrentUser
) -> ViewEstimateResponse:
    """The Settling curve and settings an Estimated View count is read through."""
    curve, reach = current_estimate(session)
    return ViewEstimateResponse(
        curve=ViewCurveResponse(**curve.wire()),
        settlingAgeHours=reach.settling_age_hours,
        estimationFloorHours=reach.estimation_floor_hours,
    )


# PFB-02. A read expressed as a POST for the reason `posts_counts` is one, and
# on `VIEW_AS_READ_ONLY_PATHS` beside it.
@router.post("/posts/facets")
def posts_facets(
    body: PostFacetsRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> PostFacetsResponse:
    """How many Posts in the window have each Type, media kind and Language.

    And how many of each value the Post selection selects.
    """
    facets = posts_view.facets(
        session, view_of(session, current_user.id, body, with_followed=True)
    )

    def counted(rows: list[tuple[str, int, int]]) -> list[PostFacetCount]:
        return [PostFacetCount(value=v, count=n, selected=m) for v, n, m in rows]

    return PostFacetsResponse(
        total=facets.total,
        types=counted(facets.types),
        languages=counted(facets.languages),
        media=counted(facets.media),
    )


@router.post("/posts/lookup")
def lookup_posts_route(
    body: PostLookupRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[SelectablePostResponse]:
    return [
        SelectablePostResponse.model_validate(row)
        for row in posts_view.lookup(
            session,
            view_of(session, current_user.id, body),
            [(ref.channel_name, ref.post_id) for ref in body.posts],
        )
    ]


# CW-01, ADR-043. A read expressed as a POST for the reason `posts_counts` is
# one, and on `VIEW_AS_READ_ONLY_PATHS` beside it.
@router.post("/posts/window-check")
def window_check(
    body: WindowCheckRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> WindowCheckResponse:
    """Which of these Channels the workspace can prove it holds every Post of,
    from the window's Start to its End or now, whichever is earlier, and why
    not. Reads what is held and which syncs are still running; never syncs.
    """
    # CW-02: the gate reads the window again as it was at its click.
    frozen_at = frozen_moment(body.frozen_at)
    window = resolve_analysis_window(body.window, now_ms=frozen_at)
    assert window.start is not None and window.end is not None, (
        "a stated window resolves both ends"
    )
    return check_window(
        session,
        user_id=current_user.id,
        names=body.channel_names,
        start=window.start,
        end=window.end,
        frozen_at=frozen_at,
    )


@router.post("/posts/bulk")
def bulk_upsert_posts_route(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> BulkUpsertPostsResponse:
    return BulkUpsertPostsResponse.model_validate(bulk_upsert_posts(session, body))
