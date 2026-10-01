"""Helpers shared by more than one `/data` family.

Only `parse_post_filters` lives here, and only because the posts feed and the
Discover aggregate must interpret an identical filter set identically — a
Discover report is an aggregation over exactly the Posts-tab view. Letting the
two parse separately is the drift the server-side aggregation exists to remove.

Keep this module small. It is not a dumping ground: anything used by one family
belongs in that family's module.
"""

from typing import Any, cast

from fastapi import HTTPException
from sqlmodel import Session

from app.schemas.posts import PostScopeRequest
from app.services.post_filters import (
    FORWARDED_FILTERS,
    MEDIA_KINDS,
    PostFilters,
    ViewReading,
    tree_measures,
)
from app.services.settling_curve import current_estimate, view_reading


def parse_post_filters(
    session: Session, body: PostScopeRequest, *, sort: str = "newest"
) -> PostFilters:
    """Validate the shared Posts-tab filters into a PostFilters.

    Rejecting unknown enum values with 422 mirrors how the frontend can only
    ever send its own filter constants. `media` is a set of kinds, empty for
    any (PFB-01). The curve an Estimated View count reads through is loaded
    only when a threshold or a views order will read it (PFB-03).
    """
    if body.forwarded not in FORWARDED_FILTERS:
        raise HTTPException(
            status_code=422, detail=f"unknown forwarded: {body.forwarded}"
        )
    unknown_media = sorted(set(body.media) - MEDIA_KINDS)
    if unknown_media:
        raise HTTPException(status_code=422, detail=f"unknown media: {unknown_media}")
    views = None if body.views is None else body.views.threshold()
    tree = None if body.filter is None else body.filter.to_tree()
    # Each measure the tree bounds gets its own reading; the curve is read
    # only when a tree bounds an Estimated View count.
    measures = tree_measures(tree) if tree else frozenset()
    tree_readings = {
        m: ViewReading(m)
        if m == "views"
        else ViewReading(m, *current_estimate(session))
        for m in measures
    }
    return PostFilters(
        keyword=body.keyword,
        forwarded=cast("Any", body.forwarded),
        media=tuple(body.media),
        languages=tuple(body.languages),
        views=views,
        reading=view_reading(session, body.view_measure, views=views, sort=sort),
        tree=tree,
        tree_readings=tree_readings,
    )
