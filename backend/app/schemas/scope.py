"""The Scope a caller submits, and the frozen Scope an Artifact records (AW-05).

An Artifact is paid for in Posts, and it has to record exactly which Posts. Until
this ticket a Summary stored channels and two epoch milliseconds and nothing
else: the keyword that narrowed the feed, the media filter, the per-channel cap
and its seed all shaped the text and none of them survived. A Discover report
stored the lot — so the same two questions ("which Posts was this made from",
"can I reproduce it") had different answers depending on which kind of Artifact
you opened.

So there is one shape submitted (`ScopeSubmission`) and one shape recorded
(`FrozenScope`), and the only thing that turns the first into the second is
`app/services/analysis_window.py::freeze_scope`. The submission states a Live or
Fixed window; the frozen value holds two exact instants, because queue delay,
worker start time, retries and network latency must not be able to move what a
finished Artifact says it used.

`durationMinutes` is derived on every validation rather than stored, so the one
number a reader actually looks at cannot disagree with the two it comes from.

Docstrings here stay to one line each where they can. A model docstring becomes
the schema description in `openapi.json` and a JSDoc block in
`src/client/types.gen.ts`, so the reasoning lives in comments, which do not ship.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.analysis_window import AnalysisWindowInput
from app.services.post_filters import ForwardedFilter, MediaFilter

#: The feed's two orders and the cap's two modes, as `services/posts.py` reads
#: them. Declared rather than left as `str` because a frozen Scope claims to be
#: reproducible, and a typo'd `sort` that silently falls through to `time` is a
#: reproduction that quietly is not one.
SortOrder = Literal["time", "channel_time"]
CapMode = Literal["latest", "random"]

#: A semantic or related-Post selection can run to the whole page of matches.
#: Bounded for the reason `PostLookupRequest` is bounded: without a ceiling this
#: is another way to ask the server to store an unbounded list.
MAX_SCOPED_POSTS = 5000


class ScopedPostRef(BaseModel):
    """One Post named by its natural key."""

    model_config = ConfigDict(populate_by_name=True)

    channel_name: str = Field(alias="channelName")
    post_id: int = Field(alias="postId")


# The filter half, shared by both shapes so a filter added later cannot reach
# the submission and miss the record. `ScopeSubmission` adds the stated window,
# `FrozenScope` the resolved instants.
class _ScopeFilters(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    channels: list[str] = Field(default_factory=list)
    keyword: str | None = None
    forwarded: ForwardedFilter = "all"
    media: MediaFilter = "all"
    max_per_channel: int = Field(0, alias="maxPerChannel", ge=0)
    max_per_channel_mode: CapMode = Field("latest", alias="maxPerChannelMode")
    sort: SortOrder = "time"
    # The `random` cap's seed. Stored because the same seed picks the same
    # Posts, which is the only thing that makes a randomly-capped Artifact
    # reproducible rather than a one-off — the argument `DiscoverReport.seed`
    # already makes one table over.
    seed: int = 0


class ScopeSubmission(_ScopeFilters):
    """The complete Scope an Action is submitted with."""

    # `extra="forbid"`, for the reason `PostScopeRequest` gives: a stale client
    # posting a shape this server does not implement must be a 422 and never a
    # 200 over a Scope that quietly dropped half of what it asked for.
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    # Required, unlike the optional `window` on the feed reads. An Artifact
    # always covers a window somebody chose; "both sides open" is a corpus walk,
    # not a Scope.
    window: AnalysisWindowInput
    # The semantic and related-Post paths rank Posts with a query the server
    # cannot reproduce from filters, so they name the selection outright. `None`
    # means the filters above are the whole story.
    posts: list[ScopedPostRef] | None = Field(default=None, max_length=MAX_SCOPED_POSTS)


class FrozenScope(_ScopeFilters):
    """The immutable Scope an Artifact was produced from."""

    start: int
    end: int
    # The size of an explicit selection; `null` means the filters were the whole
    # story. Carried on the Artifact's own row so a list can say "restricted to
    # 120 Posts" without opening the table the refs live in — the same split,
    # and the same reason, as `DiscoverReport.scoped_post_count`.
    scoped_post_count: int | None = Field(default=None, alias="scopedPostCount")
    # Detail-only: the refs themselves live in the companion payload table, so
    # `null` here means "not loaded" on a list projection and "there was no
    # explicit selection" on a detail one. `scopedPostCount` is the field that
    # tells the two apart.
    posts: list[ScopedPostRef] | None = None

    #: Exact elapsed UTC minutes between the two boundaries.
    #:
    #: Always recomputed on validation, never trusted from the input, so it is
    #: derived rather than a third fact that can drift from the two it came
    #: from. A plain field rather than a `computed_field` because a read-only
    #: property splits every model that contains this one into a Readable and a
    #: Writable half in the generated client, for a number the client only ever
    #: reads.
    duration_minutes: int = Field(default=0, alias="durationMinutes")

    @model_validator(mode="after")
    def _derive_duration(self) -> FrozenScope:
        object.__setattr__(self, "duration_minutes", (self.end - self.start) // 60_000)
        return self
