"""The posts feed, its scope counts, and bulk post writes.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

from typing import Any

from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser, SessionDep
from app.api.routes.data._shared import parse_post_filters
from app.schemas.posts import (
    BulkUpsertPostsResponse,
    PostFeedRequest,
    PostLookupRequest,
    PostResponse,
    PostScopeRequest,
)
from app.services.posts import (
    FEED_CAP_MODES,
    FEED_SORTS,
    bulk_upsert_posts,
)
from app.services.posts import count_posts_in_scope as count_posts_in_scope_impl
from app.services.posts import list_feed as list_feed_impl
from app.services.posts import lookup_posts as lookup_posts_impl

router = APIRouter()


@router.post("/posts")
def list_posts(
    body: PostFeedRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[PostResponse]:
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
    return [
        PostResponse.model_validate(row)
        for row in list_feed_impl(
            session,
            channel_names=body.resolved_channel_names(),
            start_date=body.start_date,
            end_date=body.end_date,
            filters=parse_post_filters(body.keyword, body.forwarded, body.media),
            max_per_channel=body.max_per_channel,
            max_per_channel_mode=body.max_per_channel_mode,
            sort=body.sort,
            seed=body.seed,
            limit=body.limit,
            offset=body.offset,
        )
    ]


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
        filters=parse_post_filters(body.keyword, body.forwarded, body.media),
        max_per_channel=body.max_per_channel,
    )


@router.post("/posts/lookup")
def lookup_posts_route(
    body: PostLookupRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[PostResponse]:
    return [
        PostResponse.model_validate(row)
        for row in lookup_posts_impl(
            session, [(ref.channel_name, ref.post_id) for ref in body.posts]
        )
    ]


@router.post("/posts/bulk")
def bulk_upsert_posts_route(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> BulkUpsertPostsResponse:
    return BulkUpsertPostsResponse.model_validate(bulk_upsert_posts(session, body))
