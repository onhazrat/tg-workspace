"""Response models for the post endpoints.

Third family converted under B3 of `docs/architecture-simplification-plan.md`.

Unlike `ChannelResponse` and `SummaryResponse`, `PostResponse` is **closed**:
`post_to_camel` emits a fixed set of keys and merges nothing conditional, so
there is no open `extra` blob to carry and no reason to allow one. The open
models in this codebase are the exception, not the pattern.

**Why `media` / `links` / `replyTo` stay loose.** All three are JSON columns
with real shapes, and `app/schemas/post_media.py` already models the media one
as `PostMedia`. Declaring `media: PostMedia | None` here would still be wrong:
media is persisted via `PostMedia.to_storage_dict()`, which uses
``exclude_none=True``, so a stored blob omits its empty fields. Round-tripping
it through the declared model on the way out would materialise those as explicit
``null``s and change the payload for every post that has media. FastAPI's
``response_model_exclude_none`` cannot fix this either — it applies to the whole
response, so it would strip legitimate nulls from the top-level fields as well.

The same reasoning that keeps conditional keys undeclared in `SummaryResponse`
applies here one level down: the wire format stays byte-identical, and the
fourteen scalar fields still gain real types.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic import Field as PydanticField

from app.schemas.analysis_window import AnalysisWindowInput
from app.schemas.scope import (
    CapMode,
    MediaKind,
    SortOrder,
    ViewMeasure,
    ViewsFilter,
    upgrade_legacy_scope_fields,
)
from app.services.post_filters import (
    LanguageCond,
    MediaCond,
    TreeAtom,
    TreeCond,
    TreeGroup,
    TypeCond,
    ViewsCond,
)
from app.services.posts import (
    DEFAULT_POST_PAGE_SIZE,
    MAX_POST_LOOKUP_BATCH,
    MAX_POST_PAGE_SIZE,
)
from app.services.reach import CurveKind


class PostLinkSpan(BaseModel):
    """One Link: a stretch of `text` in UTF-16 code units, href verbatim (ADR-022).

    Declared where `links` is not, because every stored entry carries all three
    keys, so the model can never invent a `null` on the way out.
    """

    offset: int
    length: int
    url: str


class PostReactionChip(BaseModel):
    """One reaction chip, as the parser wrote it (ADR-023).

    Open, with only `count` declared, because the other three keys are
    conditional: `emoji` for an ordinary chip, `customEmojiId` for a premium
    one, `isPaid` for the Stars chip. Declaring them would emit a `null` for
    each on every chip, which stored chips never had.
    """

    model_config = ConfigDict(extra="allow")

    count: int


class PostResponse(BaseModel):
    """One post, as `post_to_camel` builds it."""

    model_config = ConfigDict(populate_by_name=True)

    id: int
    channel_name: str = Field(alias="channelName")
    text: str = ""
    date: str = ""
    timestamp: int = 0
    forwarded_from: str | None = Field(default=None, alias="forwardedFrom")
    forwarded_from_name: str | None = Field(default=None, alias="forwardedFromName")
    is_anchor: bool = Field(default=False, alias="isAnchor")
    retrieved_at: int | None = Field(default=None, alias="retrievedAt")
    retrieval_job_id: str | None = Field(default=None, alias="retrievalJobId")
    retrieval_pass: str | None = Field(default=None, alias="retrievalPass")
    retrieval_source: str | None = Field(default=None, alias="retrievalSource")
    # Shaped by `app/schemas/post_media.py::PostMedia`, kept loose on purpose —
    # see the module docstring.
    media: dict[str, Any] | None = None
    # Shape: [{"url": str, "channel": str}]
    links: list[Any] | None = None
    # Null for a Post stored before LINK-01; empty when Telegram marked nothing.
    link_spans: list[PostLinkSpan] | None = Field(default=None, alias="linkSpans")
    reply_to_post_id: int | None = Field(default=None, alias="replyToPostId")
    # Shape: {"channel": str, "authorName": str, "text": str, "url": str}
    reply_to: dict[str, Any] | None = Field(default=None, alias="replyTo")
    # An ISO 639 code, "zxx" (no words) or "und" (undetermined); null while
    # the Post is unread (LANG-01).
    language: str | None = None
    # Columns since REACH-01 (ADR-024), media keys before it. Null for a count
    # means the page showed none, never zero.
    views_count: int | None = Field(default=None, alias="viewsCount")
    reaction_counts: list[PostReactionChip] | None = Field(
        default=None, alias="reactionCounts"
    )
    views_observed_at: int | None = Field(default=None, alias="viewsObservedAt")


class BulkUpsertPostsResponse(BaseModel):
    """Result of ``POST /data/posts/bulk``."""

    upserted: int = 0


class PostCountsResponse(BaseModel):
    """Per-channel Post counts for a scope, and how many were too new to judge."""

    model_config = ConfigDict(populate_by_name=True)

    counts: dict[str, int]
    # Posts an Estimated views threshold hid for being under the estimation
    # floor; 0 under the raw measure or with no threshold (PFB-03).
    too_new_to_judge: int = Field(alias="tooNewToJudge")


class ViewCurveResponse(BaseModel):
    """A Settling curve as data: the seed's steps or a fit's knots."""

    kind: CurveKind
    points: list[list[float]]


class ViewEstimateResponse(BaseModel):
    """What the browser needs to read an Estimated View count."""

    model_config = ConfigDict(populate_by_name=True)

    curve: ViewCurveResponse
    settling_age_hours: int = Field(alias="settlingAgeHours")
    estimation_floor_hours: int = Field(alias="estimationFloorHours")


class PostFacetCount(BaseModel):
    """How many Posts one choice of a filter would leave."""

    value: str
    count: int


# The Media and Language pills' counts (PFB-02); see
# `services/posts.py::count_facets_in_scope` for what each number means.
class PostFacetsResponse(BaseModel):
    """Per-choice Post counts for the Language and media filters."""

    languages: list[PostFacetCount]
    media: list[PostFacetCount]


# ---- The filter tree on the wire ---------------------------------------------
#
# The browser's Channels-style tree, as `post_filters.TreeGroup` reads it. The
# nodes carry the browser's `id` so a tree round-trips untouched; the server
# never reads it. `extra="forbid"` for the reason the Scope gives: an unknown
# condition is a 422, never a filter that quietly matches everything.

MAX_FILTER_DEPTH = 6
MAX_FILTER_NODES = 100


class _Cond(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TypeCondition(_Cond):
    type: Literal["type"]
    value: Literal["forwarded", "original", "unfollowed_forwarded"]


class MediaCondition(_Cond):
    type: Literal["media"]
    value: MediaKind


class LanguageCondition(_Cond):
    type: Literal["language"]
    value: str = Field(min_length=1, max_length=16)


class ViewsCondition(_Cond):
    type: Literal["views"]
    measure: ViewMeasure
    min: float | None = Field(None, ge=0)
    max: float | None = Field(None, ge=0)
    none: bool = False


PostCondition = Annotated[
    TypeCondition | MediaCondition | LanguageCondition | ViewsCondition,
    Field(discriminator="type"),
]


class FilterAtom(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    kind: Literal["atom"]
    id: str | None = None
    negated: bool = Field(False, alias="not")
    cond: PostCondition


class FilterGroup(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    kind: Literal["group"]
    id: str | None = None
    op: Literal["and", "or"]
    negated: bool = Field(False, alias="not")
    children: list[Annotated[FilterAtom | FilterGroup, Field(discriminator="kind")]] = (
        Field(default_factory=list)
    )

    @model_validator(mode="after")
    def _bounded(self) -> FilterGroup:
        """A tree is SQL the server builds, so its size is bounded: 422 past it."""

        def walk(node: FilterAtom | FilterGroup, depth: int) -> int:
            if depth > MAX_FILTER_DEPTH:
                raise ValueError(f"filter deeper than {MAX_FILTER_DEPTH}")
            if isinstance(node, FilterAtom):
                return 1
            return 1 + sum(walk(child, depth + 1) for child in node.children)

        if walk(self, 1) > MAX_FILTER_NODES:
            raise ValueError(f"filter larger than {MAX_FILTER_NODES} nodes")
        return self

    def to_tree(self) -> TreeGroup:
        return TreeGroup(
            op=self.op,
            negated=self.negated,
            children=tuple(
                TreeAtom(cond=_cond(child.cond), negated=child.negated)
                if isinstance(child, FilterAtom)
                else child.to_tree()
                for child in self.children
            ),
        )


def _cond(
    cond: TypeCondition | MediaCondition | LanguageCondition | ViewsCondition,
) -> TreeCond:
    if isinstance(cond, TypeCondition):
        return TypeCond(cond.value)
    if isinstance(cond, MediaCondition):
        return MediaCond(cond.value)
    if isinstance(cond, LanguageCondition):
        return LanguageCond(cond.value)
    return ViewsCond(cond.measure, cond.min, cond.max, cond.none)


class PostScopeRequest(BaseModel):
    """A post scope carried in a request body rather than a query string.

    The channel selection can run to the full account — over a thousand handles —
    which as `?channelNames=a,b,c,...` produced URLs long enough to hit proxy and
    server header limits. A body has no such ceiling.
    """

    # `extra="forbid"` is the other half of dropping `startDate`/`endDate`, and
    # without it the removal enforces nothing. Pydantic ignores unknown keys by
    # default, so a tab left open across a deploy would post the legacy pair,
    # get `window=None`, and be answered with **every Post in the corpus**
    # instead of the day it asked for — silently, with a 200. An unknown key on
    # a Scope is a client that means something this server does not do, and the
    # only safe answer is 422.
    model_config = ConfigDict(extra="forbid")

    channel_names: list[str] | None = PydanticField(None, alias="channelNames")
    # AW-02. This was `startDate`/`endDate`, two epoch milliseconds the browser
    # computed from its own clock. Removing them rather than accepting both
    # shapes is the enforcement: while the pair existed, calling the resolver
    # was a convention a new route could forget, and a route that forgot it
    # would look correct and select by a clock the server cannot see. Omitted
    # means both sides open, which is the export and lookup reads — not a Scope
    # anybody selected. Language detection is *not* one of them: it sends a
    # window like any other caller (`ScraperContext.tsx` asks for a fixed
    # lookback), and listing it here as an exception was simply wrong.
    window: AnalysisWindowInput | None = None
    keyword: str | None = None
    forwarded: str = "all"
    # The Post's own Language, any of these; empty for any (PFB-02).
    languages: list[str] = PydanticField(default_factory=list)
    # A set of kinds, empty for any; a Post matching any one is kept (PFB-01).
    media: list[MediaKind] = PydanticField(default_factory=list)
    # What `views` and the views orders read, and the threshold (PFB-03).
    view_measure: ViewMeasure = PydanticField("estimated", alias="viewMeasure")
    views: ViewsFilter | None = None
    # The Channels-style filter tree, joined with AND to the fields above. Not carried
    # into an Artifact's Scope yet (docs/post-filter-tree-plan.md).
    filter: FilterGroup | None = None
    max_per_channel: int = PydanticField(0, alias="maxPerChannel", ge=0)

    # A browser still on the previous bundle posts `media: "all"`, `sort:
    # "time"` and `maxPerChannelMode: "latest"` until it reloads. Read as the
    # new shape for one release, by the same mapping a stored Scope takes, so
    # the two can never disagree about what an old value meant. It runs before
    # `extra="forbid"` looks, which is what lets `sort` reach a subclass that
    # declares it.
    @model_validator(mode="before")
    @classmethod
    def _upgrade_legacy_shape(cls, data: Any) -> Any:
        return upgrade_legacy_scope_fields(data)

    def cleaned_channel_names(self) -> list[str] | None:
        """Non-empty, trimmed handles — matching the old comma-split behaviour."""
        if self.channel_names is None:
            return None
        names = [n.strip() for n in self.channel_names if n.strip()]
        return names or None


class PostFeedRequest(PostScopeRequest):
    """`PostScopeRequest` plus the feed's paging, cap mode and sort.

    `limit`/`offset` keep the same bounds the query params enforced, so an
    out-of-range page is still a 422 rather than an unbounded read.
    """

    channel_name: str | None = PydanticField(None, alias="channelName")
    limit: int = PydanticField(DEFAULT_POST_PAGE_SIZE, ge=1, le=MAX_POST_PAGE_SIZE)
    offset: int = PydanticField(0, ge=0)
    max_per_channel_mode: CapMode = PydanticField("ordered", alias="maxPerChannelMode")
    sort: SortOrder = "newest"
    group_by_channel: bool = PydanticField(False, alias="groupByChannel")
    seed: int = 0

    def resolved_channel_names(self) -> list[str] | None:
        """`channelNames` wins; `channelName` is the single-channel shorthand.

        Mirrors the old `if channel_names: ... elif channel_name: ...`, including
        that an empty `channelNames` falls through to the singular form.
        """
        names = self.cleaned_channel_names()
        if names:
            return names
        if self.channel_name and self.channel_name.strip():
            return [self.channel_name.strip()]
        return None


class PostLookupRef(BaseModel):
    channel_name: str = PydanticField(alias="channelName")
    post_id: int = PydanticField(alias="postId")


class PostLookupRequest(BaseModel):
    """Batch of `(channelName, postId)` refs to resolve.

    Capped so this cannot become another way to ask for unbounded rows.
    """

    posts: list[PostLookupRef] = PydanticField(max_length=MAX_POST_LOOKUP_BATCH)
