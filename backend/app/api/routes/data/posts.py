"""The posts feed, its scope counts, and bulk post writes.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

from typing import Any

from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.api.routes.data._shared import parse_post_filters, selected_in, tree_filters
from app.schemas.posts import (
    BulkUpsertPostsResponse,
    PostCountsResponse,
    PostFacetCount,
    PostFacetsRequest,
    PostFacetsResponse,
    PostFeedRequest,
    PostFilteredRequest,
    PostLookupRequest,
    SelectablePostResponse,
    ViewCurveResponse,
    ViewEstimateResponse,
)
from app.services.analysis_window import resolve_analysis_window
from app.services.post_selection import PostScope
from app.services.posts import (
    bulk_upsert_posts,
    count_facets_in_scope,
    count_shown_and_selected,
)
from app.services.posts import list_feed as list_feed_impl
from app.services.posts import lookup_posts as lookup_posts_impl
from app.services.settling_curve import current_estimate

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
    window = resolve_analysis_window(body.window)
    channel_names = body.resolved_channel_names()
    scope = PostScope(current_user.id, channel_names, window.start, window.end)
    return [
        SelectablePostResponse.model_validate(row)
        for row in list_feed_impl(
            session,
            user_id=current_user.id,
            channel_names=channel_names,
            start_date=window.start,
            end_date=window.end,
            filters=parse_post_filters(session, body, tree=body.filter, sort=body.sort),
            max_per_channel=body.max_per_channel,
            max_per_channel_mode=body.max_per_channel_mode,
            sort=body.sort,
            group_by_channel=body.group_by_channel,
            seed=body.seed,
            limit=body.limit,
            offset=body.offset,
            selected=selected_in(session, body.selection, scope),
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
    window = resolve_analysis_window(body.window)
    channel_names = body.cleaned_channel_names()
    scope = PostScope(current_user.id, channel_names, window.start, window.end)
    counted = count_shown_and_selected(
        session,
        selected_in(session, body.selection, scope),
        user_id=current_user.id,
        channel_names=channel_names,
        start_date=window.start,
        end_date=window.end,
        filters=parse_post_filters(session, body, tree=body.filter, sort=body.sort),
        max_per_channel=body.max_per_channel,
        max_per_channel_mode=body.max_per_channel_mode,
        sort=body.sort,
        seed=body.seed,
    )
    return PostCountsResponse(
        counts=counted["counts"],
        selected=counted["selected"],
        selectedShown=counted["selected_shown"],
        tooNewToJudge=counted["too_new"],
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
    window = resolve_analysis_window(body.window)
    channel_names = body.cleaned_channel_names()
    scope = PostScope(current_user.id, channel_names, window.start, window.end)
    facets = count_facets_in_scope(
        session,
        user_id=current_user.id,
        channel_names=channel_names,
        start_date=window.start,
        end_date=window.end,
        selected=selected_in(session, body.selection, scope),
    )
    return PostFacetsResponse(
        total=facets["total"],
        **{
            key: [
                PostFacetCount(value=v, count=n, selected=m) for v, n, m in facets[key]
            ]
            for key in ("types", "languages", "media")
        },
    )


@router.post("/posts/lookup")
def lookup_posts_route(
    body: PostLookupRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[SelectablePostResponse]:
    window = resolve_analysis_window(body.window)
    scope = PostScope(current_user.id, body.channel_names, window.start, window.end)
    return [
        SelectablePostResponse.model_validate(row)
        for row in lookup_posts_impl(
            session,
            [(ref.channel_name, ref.post_id) for ref in body.posts],
            user_id=current_user.id,
            filters=None if body.filter is None else tree_filters(session, body.filter),
            selected=selected_in(session, body.selection, scope),
        )
    ]


@router.post("/posts/bulk")
def bulk_upsert_posts_route(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> BulkUpsertPostsResponse:
    return BulkUpsertPostsResponse.model_validate(bulk_upsert_posts(session, body))
