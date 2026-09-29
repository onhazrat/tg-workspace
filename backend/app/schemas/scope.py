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

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.analysis_window import AnalysisWindowInput
from app.services.post_filters import CapMode as CapMode
from app.services.post_filters import FeedSort, ForwardedFilter
from app.services.post_filters import MediaKind as MediaKind

#: The feed's orders and the cap's modes, as `services/posts.py` reads them.
#: Declared rather than left as `str` because a frozen Scope claims to be
#: reproducible, and a typo'd `sort` that silently falls through to `newest` is
#: a reproduction that quietly is not one.
#: `CapMode` and `MediaKind` are re-exported for the same reason.
SortOrder = FeedSort

#: A semantic or related-Post selection can run to the whole page of matches.
#: Bounded for the reason `PostLookupRequest` is bounded: without a ceiling this
#: is another way to ask the server to store an unbounded list.
MAX_SCOPED_POSTS = 5000


def upgrade_legacy_scope_fields(data: Any) -> Any:
    """Read a filter half written in the shape before PFB-01 as the one after it.

    Two callers need it and it is the same mapping for both. A **stored** Scope
    has to keep meaning what it meant, forever: every Artifact and scheduled
    Summary written before the change holds `media: "all"` and `sort: "time"`.
    An **incoming** one is a browser still running the previous bundle, which
    keeps posting the old spelling until it reloads; that half is for one
    release, and it is the same function because the two must not disagree
    about what an old value meant.

    * `media: "all"` is `[]`, and a single kind is `[kind]`.
    * `maxPerChannelMode: "latest"` is `"ordered"`. Every old order was newest
      first within a channel, so "the first N in the order" keeps exactly the
      Posts "the latest N" kept.
    * `sort: "time"` is `"newest"`, and `sort: "channel_time"` is `"newest"`
      with `groupByChannel: true` — grouping stopped being an order.

    Anything else passes through untouched, so a value neither shape knows is
    still the validator's 422 rather than something this quietly rewrote. Both
    the alias and the field name are read, because every model it runs on
    populates by name as well.
    """
    if not isinstance(data, dict):
        return data
    upgraded = dict(data)
    media = upgraded.get("media")
    if isinstance(media, str):
        upgraded["media"] = [] if media == "all" else [media]
    for key in ("maxPerChannelMode", "max_per_channel_mode"):
        if upgraded.get(key) == "latest":
            upgraded[key] = "ordered"
    sort = upgraded.get("sort")
    if sort == "time":
        upgraded["sort"] = "newest"
    elif sort == "channel_time":
        upgraded["sort"] = "newest"
        upgraded.pop("group_by_channel", None)
        upgraded["groupByChannel"] = True
    return upgraded


def scope_key(scope: FrozenScope | None) -> dict[str, Any]:
    """The `scope` key of an Artifact projection, stamped **last**.

    Last, and that ordering is the point: three of the four Artifact rows carry
    an open `extra` column that every projection spreads, so a key named
    `scope` sitting in that bag would otherwise win over the column and the
    endpoint would report a Scope the database does not hold. Each write door
    drops such a key; this is the half that does not depend on them remembering
    to.

    `None` becomes an explicit `null` rather than an absent key. Unlike the
    conditional keys it sits beside, `scope` has no legacy wire shape to
    preserve and the client has to render it either way.

    Here rather than copied into each aggregate for the reason `FrozenScope`
    owns `stored` and `from_stored`: how a frozen Scope becomes a column is a
    property of the Scope, and so is how it becomes a wire key. It was written
    out three times first, with three copies of this paragraph.
    """
    return {"scope": None if scope is None else scope.model_dump(by_alias=True)}


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
    # PFB-01 carries the Language set without filtering on it yet, so anything
    # but the empty set is a Scope this server does not implement and is
    # refused rather than recorded as if it had been applied. PFB-02 lifts the
    # bound when the filter exists.
    languages: list[str] = Field(default_factory=list, max_length=0)
    media: list[MediaKind] = Field(default_factory=list)
    max_per_channel: int = Field(0, alias="maxPerChannel", ge=0)
    max_per_channel_mode: CapMode = Field("ordered", alias="maxPerChannelMode")
    sort: SortOrder = "newest"
    group_by_channel: bool = Field(False, alias="groupByChannel")
    # The `random` cap's seed. Stored because the same seed picks the same
    # Posts, which is the only thing that makes a randomly-capped Artifact
    # reproducible rather than a one-off — the argument `DiscoverReport.seed`
    # already makes one table over.
    seed: int = 0

    # Before, so a Scope stored in the old shape reads as the new one and never
    # reaches the literals above as a value they refuse (PFB-01). It runs on
    # both subclasses: the record for history, the submission for one release.
    @model_validator(mode="before")
    @classmethod
    def _upgrade_legacy_shape(cls, data: Any) -> Any:
        return upgrade_legacy_scope_fields(data)


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
        # And the size of the selection, whenever the selection is here. Not
        # when it is absent: `posts` is `None` on a list projection, where
        # `scopedPostCount` is the *only* thing that says a selection existed,
        # and deriving it there would erase the fact it is carried to report.
        # `0` is a real answer — a ranking that matched nothing — and is what
        # tells that apart from "the filters were the whole story".
        if self.posts is not None:
            object.__setattr__(self, "scoped_post_count", len(self.posts))
        return self

    # The pair below is what makes "one contract, four families" a fact rather
    # than four copies of the same two lines (AW-06). Each aggregate owns its
    # own tables and writes them itself, but *how a frozen Scope becomes two
    # columns* is a property of the Scope, not of whichever table is holding it
    # — and it was already subtle in one place: drop `duration_minutes` from
    # the exclusion and a derived number becomes a third stored fact that
    # nothing keeps in step.

    def stored(self) -> dict[str, Any]:
        """What the `scope` column holds.

        Without `posts`, which is corpus-sized and goes to its own column, and
        without `durationMinutes`, which is derived on every read.
        """
        return self.model_dump(by_alias=True, exclude={"posts", "duration_minutes"})

    def stored_posts(self) -> list[dict[str, Any]] | None:
        """What the `scope_posts` column holds, or `None` for no selection.

        An empty selection stores `None` too: a ranking that matched nothing
        restricted the Scope to no Posts, and `scopedPostCount` — which is `0`,
        not `null` — is what tells that apart from "the filters were the whole
        story".
        """
        if not self.posts:
            return None
        return [ref.model_dump(by_alias=True) for ref in self.posts]

    @classmethod
    def from_stored(
        cls, scope: dict[str, Any] | None, scope_posts: list[Any] | None = None
    ) -> FrozenScope | None:
        """Rebuild from the two columns; `None` for a row that predates AW-05.

        `scope_posts` left out reads back a `FrozenScope` with `posts` unset,
        which is the list projection: `scopedPostCount` is what says whether
        there was a selection, so a list can report one without opening the
        column the refs live in.
        """
        if scope is None:
            return None
        frozen = cls.model_validate(scope)
        if scope_posts is None:
            return frozen
        # Back through `model_validate`, not `model_copy`. A copy skips the
        # validators, so adding `posts` to a value whose `scopedPostCount` came
        # off the column would leave the count trusted on this path and derived
        # on every other — the two disagreeing is the whole thing the validator
        # was added to stop.
        return cls.model_validate({**frozen.stored(), "posts": scope_posts})
