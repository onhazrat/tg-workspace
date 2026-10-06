"""Wire models for the Directory's own reads (ticket 03).

Its own module rather than an addition to `discover.py`, for the reason the
route module gives: the Directory is corpus-wide and outlives every report, so
filing its read as report machinery misfiles it.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.post_filter import check_tree_bounds
from app.services.directory_reads import (
    SEARCH_FIELDS,
    DirectoryCond,
    DirectoryFlag,
    DirectoryMeasure,
    DirectorySort,
    DirectoryTree,
    FlagCond,
    LanguageCond,
    MeasureCond,
    MineCond,
    NameCond,
    ReferenceKind,
    Scale,
    SearchField,
    YoursSource,
)
from app.services.post_filters import TreeAtom, TreeGroup


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
    """Followed by this Account, or followable by anybody (the entry's verdict)."""

    type: Literal["flag"]
    value: DirectoryFlag

    def to_cond(self) -> DirectoryCond:
        return FlagCond(self.value)


class DirectoryMineCondition(_Cond):
    """Cited by your channels, ever or within the last `days`."""

    type: Literal["mine"]
    days: int | None = Field(None, ge=1, le=36_500)

    def to_cond(self) -> DirectoryCond:
        return MineCond(self.days)


DirectoryCondition = Annotated[
    DirectoryLanguageCondition
    | DirectoryNameCondition
    | DirectoryMeasureCondition
    | DirectoryFlagCondition
    | DirectoryMineCondition,
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


class DirectoryViewRequest(BaseModel):
    """A Directory view: the filter, the search, "your channels" and the Reference kinds."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    filter: DirectoryFilterGroup | None = None
    search: DirectorySearchRequest | None = None
    yours: YourChannels = Field(default_factory=YourChannels)
    #: Narrows "Cited by your channels" and the "Yours" count; empty is every kind.
    reference_kinds: list[ReferenceKind] = Field(
        default_factory=list, alias="referenceKinds", max_length=4
    )


class DirectoryListRequest(DirectoryViewRequest):
    """One page of a Directory view, sorted."""

    #: `relevance` ranks a search; with no search it falls back to handle order.
    sort: DirectorySort = "mine"
    descending: bool = True
    #: Pages of 100 rows, from 0.
    page: int = Field(0, ge=0, le=10_000)
    #: Quote each row's matching bio and Post while a search is on.
    show_matches: bool = Field(False, alias="showMatches")


class DirectoryCountRequest(DirectoryViewRequest):
    """How many entries a view leaves, with a candidate Condition added with AND."""

    candidate: DirectoryFilterAtom | None = None


class DirectoryDistributionRequest(DirectoryViewRequest):
    """A measure's spread under every other Condition of the view."""

    measure: DirectoryMeasure


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


class DirectoryRowResponse(_DirectoryEntryFields):
    """One Directory entry in the list: its measures, never its bio or samples."""

    #: Distinct Channels of "your channels" that cite it.
    mine: int
    #: The newest of those citations, epoch ms.
    mine_last_at: int | None = Field(alias="mineLastAt")
    #: Set only while a search is on and `showMatches` asked for it.
    match: DirectoryMatchResponse | None


class DirectoryEntryResponse(_DirectoryEntryFields):
    """One entry for the detail panel, read by handle: the row's measures and
    the bio, which the list never carries (DIR-03)."""

    bio: str | None


class DirectoryWhyRequest(BaseModel):
    """Whose Posts citing `handle` "Why it's here" lists."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    handle: Handle
    yours: YourChannels = Field(default_factory=YourChannels)
    reference_kinds: list[ReferenceKind] = Field(
        default_factory=list, alias="referenceKinds", max_length=4
    )
    #: The "Cited by your channels" Condition's window; every Post when absent.
    days: int | None = Field(None, ge=1, le=36_500)


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


class DirectoryWhyResponse(BaseModel):
    """The newest citing Posts, and how many there are in all."""

    posts: list[DirectoryCitingPostResponse]
    total: int


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
