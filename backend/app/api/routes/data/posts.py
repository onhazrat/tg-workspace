"""The posts feed, its scope counts, and bulk post writes.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

from typing import Any

from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.api.routes.data._shared import parse_post_filters
from app.schemas.posts import (
    BulkUpsertPostsResponse,
    PostCountsResponse,
    PostFacetCount,
    PostFacetsResponse,
    PostFeedRequest,
    PostLookupRequest,
    PostResponse,
    PostScopeRequest,
    ViewCurveResponse,
    ViewEstimateResponse,
)
from app.services.analysis_window import resolve_analysis_window
from app.services.posts import bulk_upsert_posts, count_facets_in_scope
from app.services.posts import count_scope as count_scope_impl
from app.services.posts import list_feed as list_feed_impl
from app.services.posts import lookup_posts as lookup_posts_impl
from app.services.settling_curve import view_reading

router = APIRouter()


@router.post("/posts")
def list_posts(
    body: PostFeedRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[PostResponse]:
    """One page of posts for a channel/date scope.

    With no filters, no cap and ``sort=newest`` this is the newest-first page the
    export/lookup fallbacks and language detection rely on. The Posts feed also
    passes keyword/forwarded/media filters, a per-channel cap, a sort order and
    ``offset`` so the whole view is assembled server-side instead of paging a
    channel's history into the browser.

    POST rather than GET because the scope carries the channel selection, which
    can be the entire account — see `PostScopeRequest`. This is a read expressed
    as a POST purely so the selection travels in the body.
    """
    window = resolve_analysis_window(body.window)
    return [
        PostResponse.model_validate(row)
        for row in list_feed_impl(
            session,
            user_id=current_user.id,
            channel_names=body.resolved_channel_names(),
            start_date=window.start,
            end_date=window.end,
            filters=parse_post_filters(
                session,
                body.keyword,
                body.forwarded,
                body.media,
                body.languages,
                view_measure=body.view_measure,
                views=body.views,
                sort=body.sort,
            ),
            max_per_channel=body.max_per_channel,
            max_per_channel_mode=body.max_per_channel_mode,
            sort=body.sort,
            group_by_channel=body.group_by_channel,
            seed=body.seed,
            limit=body.limit,
            offset=body.offset,
        )
    ]


@router.post("/posts/counts")
def posts_counts(
    body: PostScopeRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> PostCountsResponse:
    """Per-channel post counts for a filtered scope, computed as a SQL GROUP BY.

    Replaces the client's `buildPostsInScopeCounts`, which counted the fully
    fetched, client-filtered post array. Also says how many Posts an Estimated
    views threshold hid for being too new to judge.

    POST rather than GET because the scope carries the channel selection: this is
    a read expressed as a POST purely so the selection travels in the body.
    """
    window = resolve_analysis_window(body.window)
    counts, too_new = count_scope_impl(
        session,
        user_id=current_user.id,
        channel_names=body.cleaned_channel_names(),
        start_date=window.start,
        end_date=window.end,
        filters=parse_post_filters(
            session,
            body.keyword,
            body.forwarded,
            body.media,
            body.languages,
            view_measure=body.view_measure,
            views=body.views,
        ),
        max_per_channel=body.max_per_channel,
    )
    return PostCountsResponse(counts=counts, tooNewToJudge=too_new)


# PFB-03. A GET: it reads the curve and two settings, nothing per account.
@router.get("/posts/view-estimate")
def posts_view_estimate(
    session: SessionDep, _current_user: CurrentUser
) -> ViewEstimateResponse:
    """The Settling curve and settings an Estimated View count is read through."""
    reading = view_reading(session, "estimated")
    assert reading.curve is not None and reading.settings is not None
    return ViewEstimateResponse(
        curve=ViewCurveResponse(**reading.curve.wire()),
        settlingAgeHours=reading.settings.settling_age_hours,
        estimationFloorHours=reading.settings.estimation_floor_hours,
    )


# PFB-02. A read expressed as a POST for the reason `posts_counts` is one, and
# on `VIEW_AS_READ_ONLY_PATHS` beside it.
@router.post("/posts/facets")
def posts_facets(
    body: PostScopeRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> PostFacetsResponse:
    """How many Posts each Language and each media kind would leave in a scope."""
    window = resolve_analysis_window(body.window)
    facets = count_facets_in_scope(
        session,
        user_id=current_user.id,
        channel_names=body.cleaned_channel_names(),
        start_date=window.start,
        end_date=window.end,
        filters=parse_post_filters(
            session,
            body.keyword,
            body.forwarded,
            body.media,
            body.languages,
            view_measure=body.view_measure,
            views=body.views,
        ),
        max_per_channel=body.max_per_channel,
    )
    return PostFacetsResponse(
        languages=[PostFacetCount(value=v, count=n) for v, n in facets["languages"]],
        media=[PostFacetCount(value=v, count=n) for v, n in facets["media"]],
    )


@router.post("/posts/lookup")
def lookup_posts_route(
    body: PostLookupRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[PostResponse]:
    return [
        PostResponse.model_validate(row)
        for row in lookup_posts_impl(
            session,
            [(ref.channel_name, ref.post_id) for ref in body.posts],
            user_id=current_user.id,
        )
    ]


@router.post("/posts/bulk")
def bulk_upsert_posts_route(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> BulkUpsertPostsResponse:
    return BulkUpsertPostsResponse.model_validate(bulk_upsert_posts(session, body))
