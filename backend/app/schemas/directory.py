"""Wire models for the Directory's own reads (ticket 03).

Its own module rather than an addition to `discover.py`, for the reason the
route module gives: the Directory is corpus-wide and outlives every report, so
filing its read as report machinery misfiles it.
"""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.post_filter import check_tree_bounds
from app.services.channel_directory import MAX_PRIORITY_BOOST, BoostMode
from app.services.directory_reads import (
    SEARCH_FIELDS,
    CitedByCond,
    CitesCond,
    ContainsCond,
    ContainsField,
    DirectoryColumn,
    DirectoryCond,
    DirectoryFlag,
    DirectoryMeasure,
    DirectoryMoment,
    DirectorySort,
    DirectoryTree,
    FlagCond,
    IsCond,
    IsField,
    LanguageCond,
    MeasureCond,
    MineCond,
    NameCond,
    ReferenceKind,
    Scale,
    SearchField,
    SharedCond,
    SharedRelation,
    TagCond,
    TimeCond,
    TimeMode,
    YoursSource,
)
from app.services.post_filters import TreeAtom, TreeGroup
from app.services.telegram_web import normalize_handle


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
    #: When the probe captured the Post, which is when `views` was counted.
    #: Epoch ms.
    captured_at: int = Field(alias="capturedAt")
    #: Whether the Post carries media, from its media kinds (DIR-03).
    has_media: bool = Field(alias="hasMedia")
    #: The Telegram Links in its body. They carry no position in the text, so
    #: the panel links what the text shows and lists the rest under the Post.
    links: list[DirectorySampleLinkResponse]


class DirectorySampleLinkResponse(BaseModel):
    """A Telegram Link a sample Post carries, and the Channel it names."""

    url: str
    channel: str


# ---- The Directory filter on the wire (DIR-02) -------------------------------
#
# The browser's tree (`frontend/src/lib/filter-tree.ts`) over the Directory's
# own Conditions, as `directory_reads` reads it. The same node shape and the
# same depth and size bounds as the Post filter's (`post_filter.py`), and
# `extra="forbid"` for its reason: an unknown Condition is a 422, never a
# filter that quietly matches everything. Docstrings stay to one line because a
# model docstring ships in the generated client.


class _Cond(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DirectoryLanguageCondition(_Cond):
    type: Literal["language"]
    value: str = Field(min_length=1, max_length=16)

    def to_cond(self) -> DirectoryCond:
        return LanguageCond(self.value)


class DirectoryNameCondition(_Cond):
    """Any part of the handle or the display name, case-insensitive."""

    type: Literal["name"]
    value: str = Field(min_length=1, max_length=256)

    def to_cond(self) -> DirectoryCond:
        return NameCond(self.value)


class DirectoryMeasureCondition(_Cond):
    """A bound on a measure, either end open; `none` keeps only entries with no value."""

    type: Literal["measure"]
    measure: DirectoryMeasure
    min: float | None = None
    max: float | None = None
    none: bool = False

    def to_cond(self) -> DirectoryCond:
        return MeasureCond(self.measure, self.min, self.max, self.none)


class DirectoryFlagCondition(_Cond):
    """Followed or dismissed by this Account, or followable by anybody (the
    entry's verdict)."""

    type: Literal["flag"]
    value: DirectoryFlag

    def to_cond(self) -> DirectoryCond:
        return FlagCond(self.value)


#: Every value the Directory writes to each field, so a typo is a 422 rather
#: than a Condition that quietly matches nothing.
IS_VALUES: dict[IsField, frozenset[str]] = {
    "status": frozenset({"ok", "unavailable", "unknown"}),
    "kind": frozenset({"channel", "group", "bot", "user", "unknown"}),
}


class DirectoryIsCondition(_Cond):
    """The verdict or the kind is exactly `value`."""

    type: Literal["is"]
    field: IsField
    value: str = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def _known(self) -> DirectoryIsCondition:
        if self.value not in IS_VALUES[self.field]:
            raise ValueError(f"Not a {self.field} the Directory writes")
        return self

    def to_cond(self) -> DirectoryCond:
        return IsCond(self.field, self.value)


class DirectoryContainsCondition(_Cond):
    """Any part of the text, case-insensitive."""

    type: Literal["contains"]
    field: ContainsField
    value: str = Field(min_length=1, max_length=256)

    def to_cond(self) -> DirectoryCond:
        return ContainsCond(self.field, self.value)


#: A Live end's reach either way: a century, in ms.
_MAX_OFFSET_MS = 100 * 366 * 86_400_000
#: A Fixed end's reach either way, inside what a `datetime` holds (years 1 to
#: 9999), so an absurd instant is a 422 and never an overflow.
_MAX_INSTANT_MS = 62_000_000_000_000


class DirectoryTimeCondition(_Cond):
    """A Time bound, start included and end excluded, either end open: Fixed
    ends are epoch ms, Live ends signed ms from now."""

    type: Literal["time"]
    moment: DirectoryMoment
    mode: TimeMode
    start: int | None = Field(None, ge=-_MAX_INSTANT_MS, le=_MAX_INSTANT_MS)
    end: int | None = Field(None, ge=-_MAX_INSTANT_MS, le=_MAX_INSTANT_MS)
    none: bool = False

    @model_validator(mode="after")
    def _ordered(self) -> DirectoryTimeCondition:
        if self.mode == "live":
            for end in (self.start, self.end):
                if end is not None and abs(end) > _MAX_OFFSET_MS:
                    raise ValueError("A Live end is within a century of now")
        if self.start is not None and self.end is not None and self.end <= self.start:
            raise ValueError("A Time bound ends after it starts")
        return self

    def to_cond(self) -> DirectoryCond:
        return TimeCond(self.moment, self.mode, self.start, self.end, self.none)


class DirectoryMineCondition(_Cond):
    """Cited by your channels, ever or within the last `days`."""

    type: Literal["mine"]
    days: int | None = Field(None, ge=1, le=36_500)
    # PROTOTYPE (time-bound): the window as a Time bound on the citing Posts.
    mode: TimeMode | None = None
    start: int | None = Field(None, ge=-_MAX_INSTANT_MS, le=_MAX_INSTANT_MS)
    end: int | None = Field(None, ge=-_MAX_INSTANT_MS, le=_MAX_INSTANT_MS)

    def to_cond(self) -> DirectoryCond:
        when = None if self.mode is None else (self.mode, self.start, self.end)
        return MineCond(self.days, when)


#: How many fixed handles one "cited by" or "cites" Condition names: 500 keeps
#: a shared link under the 8 KB request line common proxies accept, and
#: anything larger is a Tag (DFP-05).
MAX_CONDITION_HANDLES = 500
#: How many Seeds one Shared parents / children Condition sends: every follow,
#: or a Channels tab selection, which can be the whole account.
MAX_SEEDS = 10_000

_SeedHandle = Annotated[str, Field(min_length=1, max_length=256)]


def _normalised(handles: list[str]) -> tuple[str, ...]:
    return tuple(sorted({normalize_handle(h) for h in handles}))


def _one_source(handles: list[str], tag: str | None, *, required: bool) -> None:
    if handles and tag is not None:
        raise ValueError("Seeds are handles or a tag, never both")
    if required and not handles and tag is None:
        raise ValueError("Seeds need handles or a tag")


class DirectoryCitedByCondition(_Cond):
    """Cited by any of the Seeds, in the view's Reference kinds."""

    type: Literal["citedby"]
    #: Fixed Seeds; send these or `tag`.
    handles: list[_SeedHandle] = Field(
        default_factory=list, max_length=MAX_CONDITION_HANDLES
    )
    #: One of the reader's Tags, resolved by the server on every read.
    tag: str | None = Field(None, min_length=1)

    @model_validator(mode="after")
    def _seeds(self) -> DirectoryCitedByCondition:
        _one_source(self.handles, self.tag, required=True)
        return self

    def to_cond(self) -> DirectoryCond:
        return CitedByCond(_normalised(self.handles), self.tag)


class DirectoryCitesCondition(_Cond):
    """Cites any of the Seeds, in the view's Reference kinds."""

    type: Literal["cites"]
    #: Fixed Seeds; send these or `tag`.
    handles: list[_SeedHandle] = Field(
        default_factory=list, max_length=MAX_CONDITION_HANDLES
    )
    #: One of the reader's Tags, resolved by the server on every read.
    tag: str | None = Field(None, min_length=1)

    @model_validator(mode="after")
    def _seeds(self) -> DirectoryCitesCondition:
        _one_source(self.handles, self.tag, required=True)
        return self

    def to_cond(self) -> DirectoryCond:
        return CitesCond(_normalised(self.handles), self.tag)


class DirectorySharedCondition(_Cond):
    """Shared parents or Shared children with the Seeds, at least `min` shared."""

    type: SharedRelation
    #: Resolved by the browser; none matches nothing. Send these or `tag`.
    handles: list[_SeedHandle] = Field(default_factory=list, max_length=MAX_SEEDS)
    #: One of the reader's Tags, resolved by the server on every read.
    tag: str | None = Field(None, min_length=1)
    min: int = Field(2, ge=1, le=10_000)

    @model_validator(mode="after")
    def _seeds(self) -> DirectorySharedCondition:
        _one_source(self.handles, self.tag, required=False)
        return self

    def to_cond(self) -> DirectoryCond:
        return SharedCond(self.type, _normalised(self.handles), self.min, self.tag)


class DirectoryTagCondition(_Cond):
    """In one of the reader's Tags; a Tag they do not have matches nothing."""

    type: Literal["tag"]
    name: str = Field(min_length=1)

    def to_cond(self) -> DirectoryCond:
        return TagCond(self.name)


DirectoryCondition = Annotated[
    DirectoryLanguageCondition
    | DirectoryNameCondition
    | DirectoryMeasureCondition
    | DirectoryFlagCondition
    | DirectoryIsCondition
    | DirectoryContainsCondition
    | DirectoryTimeCondition
    | DirectoryMineCondition
    | DirectoryCitedByCondition
    | DirectoryCitesCondition
    | DirectorySharedCondition
    | DirectoryTagCondition,
    Field(discriminator="type"),
]


class DirectoryFilterAtom(BaseModel):
    """One Condition, maybe negated."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    kind: Literal["atom"]
    id: str | None = None
    negated: bool = Field(False, alias="not")
    cond: DirectoryCondition

    def to_atom(self) -> TreeAtom[DirectoryCond]:
        return TreeAtom(cond=self.cond.to_cond(), negated=self.negated)


class DirectoryFilterGroup(BaseModel):
    """Conditions joined with AND or OR, maybe negated; parentheses are groups."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    kind: Literal["group"]
    id: str | None = None
    op: Literal["and", "or"]
    negated: bool = Field(False, alias="not")
    children: list[
        Annotated[
            DirectoryFilterAtom | DirectoryFilterGroup, Field(discriminator="kind")
        ]
    ] = Field(default_factory=list)

    @model_validator(mode="after")
    def _bounded(self) -> DirectoryFilterGroup:
        check_tree_bounds(self)
        return self

    def to_tree(self) -> DirectoryTree:
        return TreeGroup(
            op=self.op,
            negated=self.negated,
            children=tuple(
                child.to_atom()
                if isinstance(child, DirectoryFilterAtom)
                else child.to_tree()
                for child in self.children
            ),
        )


#: A Channels tab selection can be the whole account; past this, use "every follow".
MAX_YOUR_CHANNELS = 10_000

Handle = Annotated[str, Field(min_length=1, max_length=256)]


class YourChannels(BaseModel):
    """Whose citations count: every follow (resolved by the server) or the handles sent."""

    model_config = ConfigDict(extra="forbid")

    source: YoursSource = "follows"
    #: The Channels tab selection's or the ticked Channels' handles; ignored
    #: for `follows`. Empty counts 0 for every row.
    handles: list[Handle] = Field(default_factory=list, max_length=MAX_YOUR_CHANNELS)


class DirectorySearchRequest(BaseModel):
    """Words to find in a Channel's name, bio and recent Posts."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=256)
    #: Where to look; every field when omitted.
    fields: list[SearchField] = Field(
        default_factory=lambda: list(SEARCH_FIELDS), min_length=1, max_length=3
    )


class DirectoryYoursRequest(BaseModel):
    """ "Your channels" and the Reference kinds they cite in: what every read
    that counts or quotes "your channels" takes."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    yours: YourChannels = Field(default_factory=YourChannels)
    #: Narrows "Cited by your channels" and the "Yours" count; empty is every kind.
    reference_kinds: list[ReferenceKind] = Field(
        default_factory=list, alias="referenceKinds", max_length=4
    )


class DirectoryViewRequest(DirectoryYoursRequest):
    """A Directory view: the filter, the search, "your channels" and the Reference kinds."""

    filter: DirectoryFilterGroup | None = None
    search: DirectorySearchRequest | None = None


class DirectoryTargets(BaseModel):
    """What a bulk write reaches: the Ticks' handles, or a view meaning every
    entry it matches (All matching, ADR-031). Exactly one of the two."""

    handles: list[Handle] = Field(default_factory=list, max_length=MAX_YOUR_CHANNELS)
    view: DirectoryViewRequest | None = None

    @model_validator(mode="after")
    def _one_of(self) -> Self:
        if bool(self.handles) == (self.view is not None):
            raise ValueError("Name handles or a view, exactly one")
        return self


class DirectoryListRequest(DirectoryViewRequest):
    """One page of a Directory view, sorted."""

    #: `relevance` ranks a search; with no search it falls back to handle order.
    sort: DirectorySort = "mine"
    descending: bool = True
    #: Pages of 100 rows, from 0.
    page: int = Field(0, ge=0, le=10_000)
    #: Quote each row's matching bio and Post while a search is on.
    show_matches: bool = Field(False, alias="showMatches")
    #: The ticked rows first, each part in the view's sort; the total is unchanged.
    selected_first: bool = Field(False, alias="selectedFirst")
    #: The ticked handles; left out when `yours` is the ticks, which carries them.
    ticked: list[Handle] = Field(default_factory=list, max_length=MAX_YOUR_CHANNELS)
    #: The columns the rows carry (DCOL); a row leaves out every other one. An
    #: Internal is dropped for an Account without `DATA_ADMIN`.
    columns: list[DirectoryColumn] = Field(max_length=64)

    def first(self) -> list[str]:
        """The handles `selectedFirst` leads with; none while it is off."""
        if not self.selected_first:
            return []
        return self.yours.handles if self.yours.source == "ticked" else self.ticked


class DirectoryHandlesRequest(DirectoryViewRequest):
    """Every handle a view matches, in the list's sort, for Tick all (ADR-031)."""

    sort: DirectorySort = "mine"
    descending: bool = True


class DirectoryCountRequest(DirectoryViewRequest):
    """How many entries a view leaves, with a candidate Condition added with AND."""

    candidate: DirectoryFilterAtom | None = None


class DirectoryDistributionRequest(DirectoryViewRequest):
    """A measure's spread under every other Condition of the view; a moment's in epoch ms."""

    measure: DirectoryMeasure | DirectoryMoment


# Closed, and no field carries a server-side default, so every one is required
# in the generated client (the reason `DirectorySamplePostResponse` gives).
class DirectorySnippetPartResponse(BaseModel):
    """A run of snippet text; `hit` marks a matched word."""

    text: str
    hit: bool


class DirectoryMatchedPostResponse(BaseModel):
    """The newest sampled Post that matched, around its first match."""

    model_config = ConfigDict(populate_by_name=True)

    post_id: int = Field(alias="postId")
    #: Epoch ms.
    timestamp: int
    parts: list[DirectorySnippetPartResponse]


class DirectoryMatchResponse(BaseModel):
    """Why a row matched a search; a part is `null` where it did not match."""

    bio: list[DirectorySnippetPartResponse] | None
    post: DirectoryMatchedPostResponse | None


class _DirectoryEntryFields(BaseModel):
    """What the list's row and the panel's entry both show of an entry."""

    model_config = ConfigDict(populate_by_name=True)

    handle: str
    display_name: str | None = Field(alias="displayName")
    photo_url: str | None = Field(alias="photoUrl")
    language: str | None
    subscribers: int | None
    #: Reach: the median Settled View count of recent Posts.
    reach: int | None
    #: Reach came through the Settling curve, so it is an estimate.
    reach_estimated: bool = Field(alias="reachEstimated")
    posts_per_week: float | None = Field(alias="postsPerWeek")
    #: Share of sampled Posts that are forwards, 0 to 1.
    forward_share: float | None = Field(alias="forwardShare")
    #: Epoch ms.
    last_post_at: int | None = Field(alias="lastPostAt")
    #: When the Directory found it, epoch ms.
    found_at: int = Field(alias="foundAt")
    photos: int | None
    videos: int | None
    files: int | None
    links: int | None
    followable: bool
    followed: bool
    #: This Account dismissed it (DIR-06); Follow is withheld until taken back.
    dismissed: bool
    #: Distinct Channels citing it, every Reference kind.
    cited_by: int = Field(alias="citedBy")
    #: The reader's Tags on it, as first written (DFP-04).
    tags: list[str]
    #: Distinct Channels it cites, every Reference kind.
    cites: int


class DirectoryRowResponse(BaseModel):
    """One Directory entry in the list: what every row needs, and the columns
    the request asked for (DCOL).

    A column field is **absent** when the request did not ask for it, never
    `null`, because `null` already means "not measured". The route serialises
    with `exclude_unset` for that reason, which is why every column field
    carries a default here and the always-present ones carry none.
    """

    model_config = ConfigDict(populate_by_name=True)

    handle: str
    display_name: str | None = Field(alias="displayName")
    photo_url: str | None = Field(alias="photoUrl")
    followable: bool
    followed: bool
    #: This Account dismissed it (DIR-06); Follow is withheld until taken back.
    dismissed: bool
    #: The reader's Tags on it, as first written (DFP-04).
    tags: list[str]
    #: Set only while a search is on and `showMatches` asked for it.
    match: DirectoryMatchResponse | None
    #: Shared parents with the first such Condition's Seeds; `null` while off.
    shared_parents: int | None = Field(alias="sharedParents")
    #: Shared children with the first such Condition's Seeds; `null` while off.
    shared_children: int | None = Field(alias="sharedChildren")

    language: str | None = None
    subscribers: int | None = None
    #: Reach: the median Settled View count of recent Posts.
    reach: int | None = None
    #: Reach came through the Settling curve, so it is an estimate.
    reach_estimated: bool | None = Field(None, alias="reachEstimated")
    posts_per_week: float | None = Field(None, alias="postsPerWeek")
    #: Share of sampled Posts that are forwards, 0 to 1.
    forward_share: float | None = Field(None, alias="forwardShare")
    #: Epoch ms.
    last_post_at: int | None = Field(None, alias="lastPostAt")
    #: Distinct Channels of "your channels" that cite it.
    mine: int | None = None
    #: The newest of those citations, epoch ms.
    mine_last_at: int | None = Field(None, alias="mineLastAt")
    #: Distinct Channels citing it, every Reference kind.
    cited_by: int | None = Field(None, alias="citedBy")
    #: Distinct Channels it cites, every Reference kind.
    cites: int | None = None
    #: When the Directory found it, epoch ms.
    found_at: int | None = Field(None, alias="foundAt")
    photos: int | None = None
    videos: int | None = None
    files: int | None = None
    links: int | None = None
    #: `ok`, `unavailable` or `unknown`: the verdict of the last conclusive probe.
    status: str | None = None
    #: `channel`, `group`, `bot`, `user` or `unknown`. `DATA_ADMIN` only.
    kind: str | None = None
    bio: str | None = None
    #: How many sample Posts the statistics were computed from.
    sample_count: int | None = Field(None, alias="sampleCount")
    #: When a conclusive answer was last recorded, epoch ms.
    checked_at: int | None = Field(None, alias="checkedAt")
    #: When the answer goes stale and the handle is due again, epoch ms.
    refresh_due_at: int | None = Field(None, alias="refreshDueAt")
    #: Consecutive inconclusive fetches. `DATA_ADMIN` only, as are the rest.
    attempts: int | None = None
    last_error: str | None = Field(None, alias="lastError")
    #: Every attempt, conclusive or not, epoch ms.
    attempted_at: int | None = Field(None, alias="attemptedAt")
    #: When an inconclusive handle may be tried again, epoch ms.
    retry_after: int | None = Field(None, alias="retryAfter")
    #: Drain order, lower first.
    priority: int | None = None
    #: The Operator's Priority boost; positive fetches sooner.
    priority_boost: int | None = Field(None, alias="priorityBoost")
    #: `priority - priorityBoost`, the order the Directory fetches in.
    effective_priority: int | None = Field(None, alias="effectivePriority")
    telegram_chat_id: int | None = Field(None, alias="telegramChatId")
    latest_id: int | None = Field(None, alias="latestId")


class DirectoryColumnResponse(BaseModel):
    """One column a caller may show, and whether it is on by default."""

    key: DirectoryColumn
    default: bool


class DirectoryColumnDefaultsRequest(BaseModel):
    """The columns on by default for the whole deployment; the rest are off."""

    model_config = ConfigDict(extra="forbid")

    on: list[DirectoryColumn] = Field(max_length=64)


class DirectoryHandlesResponse(BaseModel):
    """Every handle a view matches, for Tick all (ADR-031)."""

    handles: list[str]


class DirectoryBoostRequest(DirectoryTargets):
    """Set the Priority boost of the named entries, or add to it (DPF)."""

    model_config = ConfigDict(extra="forbid")

    mode: BoostMode
    #: Positive fetches sooner. An `add` that carries any entry past the range
    #: is refused for the whole batch.
    value: int = Field(ge=-MAX_PRIORITY_BOOST, le=MAX_PRIORITY_BOOST)


class DirectoryBoostResponse(BaseModel):
    """How many of the named entries the Directory holds, and so changed."""

    changed: int


#: The most handles one paste may add (DADD).
MAX_ADDED_HANDLES = 100_000


class DirectoryAddRequest(BaseModel):
    """Handles an Operator pasted, to queue for a fetch without a Follow (DADD)."""

    model_config = ConfigDict(extra="forbid")

    handles: list[Handle] = Field(min_length=1, max_length=MAX_ADDED_HANDLES)


class DirectoryAddResponse(BaseModel):
    """What became of a paste: queued, already in the Directory, or not a handle."""

    model_config = ConfigDict(populate_by_name=True)

    added: int
    already_in_directory: int = Field(alias="alreadyInDirectory")
    invalid: int


class DirectoryEntryResponse(_DirectoryEntryFields):
    """One entry for the detail panel, read by handle: the row's measures and
    the bio, which the list never carries (DIR-03)."""

    bio: str | None
    #: These three for a `DATA_ADMIN` reader only, absent otherwise (DPF).
    kind: str | None = None
    priority_boost: int | None = Field(None, alias="priorityBoost")
    effective_priority: int | None = Field(None, alias="effectivePriority")


class DirectoryTagSeeds(BaseModel):
    """Seeds from one of the reader's Tags, resolved by the server."""

    model_config = ConfigDict(extra="forbid")

    tag: str = Field(min_length=1)


#: A Shared Condition's Seeds: handles the browser resolved, or a Tag.
Seeds = Annotated[list[Handle], Field(max_length=MAX_SEEDS)] | DirectoryTagSeeds


class DirectoryWhyRequest(DirectoryYoursRequest):
    """Whose Posts citing `handle` "Why it's here" lists."""

    handle: Handle
    #: The "Cited by your channels" Condition's window; every Post when absent.
    days: int | None = Field(None, ge=1, le=36_500)
    # PROTOTYPE (time-bound): the Condition's window as a Time bound.
    mine_mode: TimeMode | None = Field(None, alias="mineMode")
    mine_start: int | None = Field(None, alias="mineStart")
    mine_end: int | None = Field(None, alias="mineEnd")
    #: The Shared parents Condition's Seeds, when it is on (DIR-07).
    parents: Seeds | None = None
    #: The Shared children Condition's Seeds, when it is on.
    children: Seeds | None = None

    def shared(self) -> DirectoryTree:
        """The Shared Conditions whose Seeds the panel names, as a tree, so
        `resolve_view` resolves a Tag here as it does for the list."""
        sides: tuple[tuple[SharedRelation, Seeds | None], ...] = (
            ("parents", self.parents),
            ("children", self.children),
        )
        return TreeGroup(
            op="and",
            children=tuple(
                TreeAtom(
                    cond=SharedCond(relation, (), tag=seeds.tag)
                    if isinstance(seeds, DirectoryTagSeeds)
                    else SharedCond(relation, _normalised(seeds))
                )
                for relation, seeds in sides
                if seeds is not None
            ),
        )


class DirectoryCitingPostResponse(BaseModel):
    """One Post of "your channels" that cites the Channel."""

    model_config = ConfigDict(populate_by_name=True)

    channel: str
    display_name: str | None = Field(alias="displayName")
    post_id: int = Field(alias="postId")
    #: Epoch ms.
    timestamp: int
    #: Every Reference kind the Post cites it in.
    kinds: list[ReferenceKind]
    #: `null` where the Account may not read the Post and no sample holds it.
    text: str | None


class DirectorySharedChannelResponse(BaseModel):
    """A Channel linking the candidate to the Seeds."""

    model_config = ConfigDict(populate_by_name=True)

    handle: str
    display_name: str | None = Field(alias="displayName")


class DirectorySharedWhyResponse(BaseModel):
    """A few of the Channels shared with the Seeds, and how many in all."""

    channels: list[DirectorySharedChannelResponse]
    total: int


class DirectoryWhyResponse(BaseModel):
    """The newest citing Posts, how many in all, and the shared Channels per relation on."""

    posts: list[DirectoryCitingPostResponse]
    total: int
    #: `null` unless the request sent Shared parents Seeds.
    parents: DirectorySharedWhyResponse | None
    #: `null` unless the request sent Shared children Seeds.
    children: DirectorySharedWhyResponse | None


class DirectoryNeighbourResponse(BaseModel):
    """A Channel at the other end of a citation, and how much it cites."""

    model_config = ConfigDict(populate_by_name=True)

    handle: str
    display_name: str | None = Field(alias="displayName")
    #: References between the two, every kind.
    references: int
    kinds: list[ReferenceKind]


class DirectoryNeighboursResponse(BaseModel):
    """The Channels citing one most, and those it cites most."""

    model_config = ConfigDict(populate_by_name=True)

    cited_by: list[DirectoryNeighbourResponse] = Field(alias="citedBy")
    cites: list[DirectoryNeighbourResponse]


class DirectoryLanguageCountResponse(BaseModel):
    """How many entries in the view have one Language; `null` is none read."""

    language: str | None
    count: int


class DirectoryListResponse(BaseModel):
    """One page, the view's total and its Language counts."""

    model_config = ConfigDict(populate_by_name=True)

    rows: list[DirectoryRowResponse]
    total: int
    #: Counted without the view's Language Conditions, for the Language menu.
    languages: list[DirectoryLanguageCountResponse]
    #: How many Channels "your channels" are; 0 means every "Yours" count is 0.
    yours_size: int = Field(alias="yoursSize")


class DirectoryCountResponse(BaseModel):
    """How many entries a view leaves."""

    total: int


class DirectorySizeResponse(BaseModel):
    """How many Channels the Directory lists at all."""

    size: int


class DirectoryBinResponse(BaseModel):
    """One histogram bar: entries with a value from `lo` to `hi`."""

    lo: float
    hi: float
    count: int


class DirectoryDistributionResponse(BaseModel):
    """A measure's spread, for the bound editor."""

    model_config = ConfigDict(populate_by_name=True)

    scale: Scale
    total: int
    #: Entries with no value, which fail any bound on this measure.
    no_value: int = Field(alias="noValue")
    min: float | None
    max: float | None
    median: float | None
    bins: list[DirectoryBinResponse]
