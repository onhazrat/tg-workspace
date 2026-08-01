"""Helpers shared by more than one `/data` family.

Only `parse_post_filters` lives here, and only because the posts feed and the
Discover aggregate must interpret an identical filter triple identically — a
Discover report is an aggregation over exactly the Posts-tab view. Letting the
two parse separately is the drift the server-side aggregation exists to remove.

Keep this module small. It is not a dumping ground: anything used by one family
belongs in that family's module.
"""

from typing import Any, cast

from fastapi import HTTPException

from app.services.post_filters import (
    FORWARDED_FILTERS,
    MEDIA_FILTERS,
    PostFilters,
)


def parse_post_filters(keyword: str | None, forwarded: str, media: str) -> PostFilters:
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
