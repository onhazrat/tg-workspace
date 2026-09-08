"""Wire models for the Directory's own reads (ticket 03).

Its own module rather than an addition to `discover.py`, for the reason the
route module gives: the Directory is corpus-wide and outlives every report, so
filing its read as report machinery misfiles it.
"""

from pydantic import BaseModel, ConfigDict, Field


# Closed, and `postId`/`text`/`timestamp` carry **no server-side default**, which
# is what puts this call on the generated client rather than beside its
# hand-written Discover neighbours (ticket 03). OpenAPI marks a defaulted field
# optional, so `text: str = ""` would emit as `text?: string` and hand the
# browser an all-optional type it has to narrow before rendering — the downgrade
# that keeps `ragSearch` hand-written. Asserted from the other side by
# `frontend/src/api/client-split.conform.ts`, and the field set is pinned by
# `tests/api/test_directory_posts_projection.py`.
class DirectorySamplePostResponse(BaseModel):
    """One Post off a Channel's preview page, as the last probe captured it.

    The text travels whole; truncation is the reader's.
    """

    model_config = ConfigDict(populate_by_name=True)

    post_id: int = Field(alias="postId")
    #: Empty string for a Post that carried no words. A media Post with no
    #: caption reaches storage with a synthesised placeholder (`[photo]`), which
    #: is what the panel shows.
    text: str
    #: Epoch **ms**, as every other `tg_*` timestamp on the wire.
    timestamp: int
    #: Telegram's view counter, `null` where the page rendered none — ordinary
    #: on older Posts, and the reason the median has its own threshold.
    views: int | None = None
