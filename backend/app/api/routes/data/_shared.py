"""Helpers shared by more than one `/data` family.

Only `parse_post_filters` lives here, and only because the posts feed and the
Discover aggregate must interpret an identical filter set identically — a
Discover report is an aggregation over exactly the Posts-tab view. Letting the
two parse separately is the drift the server-side aggregation exists to remove.

Keep this module small. It is not a dumping ground: anything used by one family
belongs in that family's module.
"""

from collections.abc import Sequence
from typing import Any, cast

from fastapi import HTTPException
from sqlmodel import Session

from app.schemas.scope import ViewMeasure, ViewsFilter
from app.services.post_filters import (
    FORWARDED_FILTERS,
    MEDIA_KINDS,
    VIEW_SORTS,
    PostFilters,
)
from app.services.settling_curve import view_reading


def parse_post_filters(
    session: Session,
    keyword: str | None,
    forwarded: str,
    media: Sequence[str],
    languages: Sequence[str],
    *,
    view_measure: ViewMeasure = "estimated",
    views: ViewsFilter | None = None,
    sort: str = "newest",
) -> PostFilters:
    """Validate the shared Posts-tab filters into a PostFilters.

    Rejecting unknown enum values with 422 mirrors how the frontend can only
    ever send its own filter constants. `media` is a set of kinds, empty for
    any (PFB-01). The curve an Estimated View count reads through is loaded
    only when a threshold or a views order will read it (PFB-03).
    """
    if forwarded not in FORWARDED_FILTERS:
        raise HTTPException(status_code=422, detail=f"unknown forwarded: {forwarded}")
    unknown_media = sorted(set(media) - MEDIA_KINDS)
    if unknown_media:
        raise HTTPException(status_code=422, detail=f"unknown media: {unknown_media}")
    return PostFilters(
        keyword=keyword,
        forwarded=cast("Any", forwarded),
        media=cast("Any", tuple(media)),
        languages=tuple(languages),
        views=None if views is None else views.threshold(),
        reading=view_reading(
            session, view_measure, needed=views is not None or sort in VIEW_SORTS
        ),
    )
