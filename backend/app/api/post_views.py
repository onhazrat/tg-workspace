"""Reading a Posts view out of a request, for every Posts route (ADR-036).

The feed, the counts, the facets, both histograms and the lookup read their
body into one `PostsView` here and hand it to `services/posts_view`, so no
route resolves an Analysis window, a Post filter or a Post selection itself.
The Discover route and the Action path have no Posts request to read and call
`resolve_posts_view` with plain values instead. It lives beside `deps.py`, as
`directory_views.py` does, so no route module imports another.
"""

import uuid

from sqlmodel import Session

from app.schemas.post_filter import to_steps
from app.schemas.posts import (
    PostFacetsRequest,
    PostFeedRequest,
    PostFilteredRequest,
    PostLookupRequest,
    PostWindowRequest,
)
from app.services.analysis_window import resolve_analysis_window
from app.services.posts_view import PostsView, resolve_posts_view


def view_of(
    session: Session,
    user_id: uuid.UUID,
    body: PostWindowRequest | PostLookupRequest,
    *,
    with_estimate: bool = False,
    with_followed: bool = False,
) -> PostsView:
    """The Posts view `body` describes, for `user_id`.

    A field a body does not carry is the view's default: no keyword, no tree,
    no cap, newest first, select all. The feed takes `channelName` as the
    single-Channel shorthand; the lookup's Channels are where the selection's
    rules reach, taken as sent.
    """
    window = resolve_analysis_window(body.window)
    if isinstance(body, PostFeedRequest):
        channel_names = body.resolved_channel_names()
    elif isinstance(body, PostLookupRequest):
        channel_names = body.channel_names
    else:
        channel_names = body.cleaned_channel_names()
    selection = (
        body.selection
        if isinstance(body, PostFilteredRequest | PostFacetsRequest | PostLookupRequest)
        else None
    )
    tree = (
        body.filter.to_tree()
        if isinstance(body, PostFilteredRequest | PostLookupRequest)
        and body.filter is not None
        else None
    )
    # A body without the fields reads as the view's defaults.
    filtered = body if isinstance(body, PostFilteredRequest) else _DEFAULTS
    return resolve_posts_view(
        session,
        user_id=user_id,
        channel_names=channel_names,
        start=window.start,
        end=window.end,
        tree=tree,
        keyword=filtered.keyword,
        view_measure=filtered.view_measure,
        max_per_channel=filtered.max_per_channel,
        cap_mode=filtered.max_per_channel_mode,
        sort=filtered.sort,
        seed=filtered.seed,
        steps=None if selection is None else to_steps(selection),
        with_estimate=with_estimate,
        with_followed=with_followed,
    )


_DEFAULTS = PostFilteredRequest.model_validate({})
