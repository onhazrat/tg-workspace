"""Request and response models for the Discover endpoints.

Fourth family converted under B4 of `docs/architecture-simplification-plan.md`,
and the first one with real nesting: a candidate carries per-signal counts, a
per-carrier breakdown, a Reference pointer and an optional probe verdict. That
nesting is exactly why it was worth typing — `dict[str, Any]` here erased four
levels of structure at once, and the frontend hand-maintains all of it.

Every model in this module is **closed**. Nothing in the Discover family merges
an open `extra` blob the way `Summary` and `Channel` do.

## Why the candidate model is split in two

`DiscoverCandidateResponse` is what `compute_discover_candidates` produces;
`ReportCandidateResponse` adds the one key a *saved* report resolves at read
time, `probe`. They are separate models rather than one model with an optional
`probe` because `POST /discover/candidates` does not emit that key at all today,
and a declared optional field serialises as an explicit ``null`` where the key
is absent — the same rule that keeps conditional keys out of `SummaryResponse`.

`DiscoverReportResponse` / `DiscoverReportListItemResponse` split for the same
reason and mirror the summaries pair: the list projection deliberately ships
`candidateCount` instead of the corpus-sized `candidates` array.

## On declaring the stored candidate blob

`report_to_camel` reads `candidates` back out of a JSON column, so a closed
model here is only safe if every persisted row has every key. It does:
`_to_candidate` is the single writer, has had one implementation since it was
introduced, and `create_report` is the only caller that constructs a
`DiscoverReport`. This is the condition B3 identified as the prerequisite for
declaring a nested model — the stored shape is complete — and unlike post media
it holds here.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic import Field as PydanticField

from app.schemas.posts import PostScopeRequest


class SignalCountsResponse(BaseModel):
    """References by signal kind.

    Always carries all three kinds even when the request enabled a subset, so a
    caller can render a stable set of columns.
    """

    forward: int = 0
    mention: int = 0
    link: int = 0


class ScopeCountsResponse(BaseModel):
    """How many posts in scope carried each signal kind.

    Post-level, not reference-level: a post forwarding two channels counts once
    towards `forwardPosts`, which is what makes these comparable with
    `postsInScope`.
    """

    model_config = ConfigDict(populate_by_name=True)

    forward_posts: int = Field(default=0, alias="forwardPosts")
    mention_posts: int = Field(default=0, alias="mentionPosts")
    link_posts: int = Field(default=0, alias="linkPosts")


class CandidateReferenceResponse(BaseModel):
    """The Reference: the most recent Post in a followed Channel that named a
    candidate.

    A pointer rather than the post body on purpose: retention may prune the post
    later, and callers render a Telegram web-view link from these three fields so
    the evidence stays reachable outside our corpus.

    It was a "sample post" until ticket 01 of discover-signals. The word now
    means only the Directory's snapshot of a Channel's *own* Posts, which points
    the opposite way: a Reference belongs to somebody else's Channel.
    """

    model_config = ConfigDict(populate_by_name=True)

    channel_name: str = Field(alias="channelName")
    post_id: int = Field(alias="postId")
    timestamp: int


class CandidateSeenInResponse(BaseModel):
    """One carrier channel's contribution to a candidate's totals."""

    model_config = ConfigDict(populate_by_name=True)

    channel_name: str = Field(alias="channelName")
    counts: SignalCountsResponse
    total: int


class MediaMixResponse(BaseModel):
    """The four media counters as shares of each other, summing to 1.

    A share rather than a percentage of the Post count, because those counters
    come from Telegram's channel info bar and count **media items, not Posts**:
    an album of five photos adds five, and a Post carrying a photo and a link
    counts in both. The latest Post id is no better a denominator, since deleted
    and service messages consume ids. Inflated on both sides it is not a
    percentage, and presenting it as one would be lying with a number.

    `null` on a leg means Telegram showed no counter of that kind, which is not
    a share of zero — a photo-only Channel has three nulls and `photos: 1.0`.
    All four keys always travel, so the shape is closed and the bar can render a
    stable set of segments.
    """

    photos: float | None = None
    videos: float | None = None
    files: float | None = None
    links: float | None = None


class HandleProbeResponse(BaseModel):
    """A cached verdict about one handle, as `probe_to_camel` builds it.

    `status` is the structural fact (`ok` | `unavailable` | `unknown`); `kind`
    (`channel` | `group` | `bot` | `user` | `unknown`) is an HTML heuristic that
    sharpens the wording and is never filtered on.
    """

    model_config = ConfigDict(populate_by_name=True)

    handle: str
    status: str = "unknown"
    kind: str = "unknown"
    display_name: str | None = Field(default=None, alias="displayName")
    bio: str | None = None
    # Raw text as Telegram renders it ("12.3K"), deliberately not parsed.
    subscribers: str | None = None
    # The other four counters the preview page carries, same raw text, spelled
    # as `Channel` spells them so a follow needs no translation (ticket 01).
    photos: str | None = None
    videos: str | None = None
    files: str | None = None
    links: str | None = None
    # The only identity that survives a handle rename.
    telegram_chat_id: int | None = Field(default=None, alias="telegramChatId")
    photo_url: str | None = Field(default=None, alias="photoUrl")
    attempts: int = 0
    last_error: str | None = Field(default=None, alias="lastError")
    checked_at: int | None = Field(default=None, alias="checkedAt")

    # What the Channel's sample Posts said about it (ticket 02, ADR-015).
    # `null` is *not measured* on every one of these, never zero: a Channel
    # that posts nothing and a Channel nobody has looked at are different
    # claims and a sort must not rank them together.
    #
    # Below the five-sample threshold only `sampleCount` and `lastPostAt`
    # survive, so a row showing no cadence can say why.
    last_post_at: int | None = Field(default=None, alias="lastPostAt")
    sample_count: int | None = Field(default=None, alias="sampleCount")
    #: Intervals over the span the samples cover, weekly. **Not** the Post count
    #: divided by the span — N Posts give N-1 intervals — and a recent rate
    #: rather than a lifetime average, which is why the UI labels it as one.
    posts_per_week: float | None = Field(default=None, alias="postsPerWeek")
    median_views: int | None = Field(default=None, alias="medianViews")
    forward_share: float | None = Field(default=None, alias="forwardShare")
    #: Which alphabet the sample captions are predominantly written in — a
    #: script, not a language. Panel-only: it appears on no row and in no sort.
    script: str | None = None

    # Derived at read from the four counters and the latest Post id, columns on
    # the same row (ADR-015). They do not outlive the page: an `unavailable`
    # verdict is synthesised with no page at all, so a Channel Telegram stops
    # serving loses both while keeping every statistic above. That asymmetry is
    # deliberate — the subscriber count is already cleared on that same path.
    media_mix: MediaMixResponse | None = Field(default=None, alias="mediaMix")
    #: Media items per published Post id. A rate, and it may exceed 1: an album
    #: of five photos adds five items against one id. `null` where the entry has
    #: no latest Post id, which is every entry the Directory seed created.
    media_density: float | None = Field(default=None, alias="mediaDensity")


class DiscoverCandidateResponse(BaseModel):
    """One discovered handle, as `_to_candidate` builds it.

    `isFollowed` / `isIgnored` are resolved against live state, never frozen —
    counts are historical, follow state is not.
    """

    model_config = ConfigDict(populate_by_name=True)

    name: str
    display_name: str | None = Field(default=None, alias="displayName")
    counts: SignalCountsResponse
    total: int = 0
    seen_in: list[CandidateSeenInResponse] = Field(default_factory=list, alias="seenIn")
    seen_in_count: int = Field(default=0, alias="seenInCount")
    last_seen: int = Field(default=0, alias="lastSeen")
    is_followed: bool = Field(default=False, alias="isFollowed")
    is_ignored: bool = Field(default=False, alias="isIgnored")
    reference: CandidateReferenceResponse


class ReportCandidateResponse(DiscoverCandidateResponse):
    """A candidate read back from a saved report, with its probe verdict joined.

    `probe` is `null` for a handle nothing has looked at yet, which callers must
    render as "not checked" rather than as a verdict: an unprobed handle and one
    confirmed unfollowable must not look the same.
    """

    probe: HandleProbeResponse | None = None


class DiscoverCandidatesResponse(BaseModel):
    """Result of the stateless aggregation, `POST /discover/candidates`."""

    model_config = ConfigDict(populate_by_name=True)

    candidates: list[DiscoverCandidateResponse] = Field(default_factory=list)
    scope_counts: ScopeCountsResponse = Field(alias="scopeCounts")
    # Every post that survived the filters and the per-channel cap. Tells an
    # empty scope apart from one where posts exist but reference nothing.
    posts_in_scope: int = Field(default=0, alias="postsInScope")


class DiscoverReportScopeResponse(BaseModel):
    """The frozen inputs a report was generated for.

    Rendered by the scope card instead of live selection state — after the user
    changes tabs, live state no longer describes where the numbers came from.
    """

    model_config = ConfigDict(populate_by_name=True)

    channels: list[str] = Field(default_factory=list)
    start_date: int = Field(default=0, alias="startDate")
    end_date: int = Field(default=0, alias="endDate")
    signals: list[str] = Field(default_factory=list)
    keyword: str | None = None
    forwarded: str = "all"
    media: str = "all"
    max_per_channel: int = Field(default=0, alias="maxPerChannel")
    max_per_channel_mode: str = Field(default="latest", alias="maxPerChannelMode")
    seed: int = 0
    # How many posts the scope was explicitly restricted to; `null` means
    # unrestricted. A semantic query passes its matches in.
    scoped_post_count: int | None = Field(default=None, alias="scopedPostCount")


class DiscoverReportListItemResponse(BaseModel):
    """A saved report without its candidate rows, as the history list ships it.

    `candidates` is the corpus-sized field — a wide-scope report holds the full
    single-reference tail — so the list carries `candidateCount` instead.

    `isStarred` and `note` are declared rather than riding in an open `extra`
    bag — see `TagRunListItemResponse` for why the closed model is worth
    keeping.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    scope: DiscoverReportScopeResponse
    scope_counts: ScopeCountsResponse = Field(alias="scopeCounts")
    posts_in_scope: int = Field(default=0, alias="postsInScope")
    is_starred: bool = Field(default=False, alias="isStarred")
    note: str | None = None
    timestamp: int = 0
    candidate_count: int = Field(default=0, alias="candidateCount")


class DiscoverReportFlagsRequest(BaseModel):
    """Body for `PUT /data/discover/reports/{id}/flags`.

    Only the small UI flags. A report's scope and candidates are immutable by
    design — a different scope produces a new report — so there is deliberately
    no way to edit them here.
    """

    model_config = ConfigDict(populate_by_name=True)

    is_starred: bool | None = Field(default=None, alias="isStarred")
    note: str | None = None

    def to_service_body(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_unset=True)


class DiscoverReportResponse(DiscoverReportListItemResponse):
    """A saved report with every candidate and its live follow/probe state."""

    candidates: list[ReportCandidateResponse] = Field(default_factory=list)


class IgnoredChannelResponse(BaseModel):
    """One dismissed candidate."""

    model_config = ConfigDict(populate_by_name=True)

    handle: str
    reason: str | None = None
    created_at: int = Field(default=0, alias="createdAt")


class DiscoverIgnoreRequest(BaseModel):
    """Handles to dismiss, or to un-dismiss.

    A list rather than a path parameter so a batch can be toggled in one call —
    which is why the DELETE carries a body too.
    """

    handles: list[str]
    reason: str | None = None


class DiscoverIgnoredAddedResponse(BaseModel):
    """Handles newly dismissed. Excludes ones already dismissed: the call is
    idempotent, so a re-dismissal is a no-op rather than an error."""

    ignored: list[str] = Field(default_factory=list)


class DiscoverIgnoredRemovedResponse(BaseModel):
    """Handles whose dismissal was undone. Unknown handles are omitted."""

    removed: list[str] = Field(default_factory=list)


class DiscoverProbeRequest(BaseModel):
    """Handles whose cached verdict should be discarded and re-queued."""

    handles: list[str]


class DiscoverProbeQueueResponse(BaseModel):
    """Probe queue state, for the progress display.

    `queued` and `retrying` are split because they behave differently on screen:
    `queued` drains to zero and can drive a progress bar, while `retrying` may
    never reach zero — a permanently unreachable handle keeps retrying at the
    backoff ceiling forever, by design.
    """

    queued: int = 0
    retrying: int = 0
    resolved: int = 0
    unavailable: int = 0
    #: The operator's pause switch — the ordinary job toggle, so pausing is
    #: durable and every open tab agrees about it.
    enabled: bool = False
    running: bool = False

    #: What the probe lane has spent today, and over the last seven days
    #: (ticket 04). Deployment-wide totals with no owner behind them: a probe
    #: answers a question about the corpus, so these are not anybody's quota and
    #: no account's ledger is touched to produce them.
    #:
    #: Here rather than on a route of their own because this read is already the
    #: probe dashboard, and the number an Operator wants beside "how much is
    #: queued" is "what has that been costing". The window is a total rather
    #: than a series: a series is a chart nothing renders yet, and the question
    #: this answers is whether the crawl has changed shape since yesterday.
    requestsToday: int = 0
    requestsWeek: int = 0

    #: The harvest sweep's switch and whether a tick is in flight (ticket 04).
    #:
    #: Its two cursor marks went with ticket 05: the sweep tracks its progress
    #: on `Post.harvested` rather than in the settings row, so there is no
    #: position to report. "How much is left" is a count over the unharvested
    #: set, which is a question nothing asks yet and which would cost a scan of
    #: that index on every read of this dashboard.
    harvestEnabled: bool = False
    harvestRunning: bool = False


class DiscoverProbeRecheckResponse(BaseModel):
    """The handles now queued for a fresh probe.

    Includes handles that had never been probed: the UI offers recheck on rows
    whose verdict has not arrived yet, so asking for one nobody has looked at is
    reasonable rather than an error. A list, not a count — the caller needs to
    know *which* rows to repaint as pending.
    """

    requeued: list[str] = Field(default_factory=list)


class DiscoverProbeRefreshResponse(BaseModel):
    """The handles now due for a fresh fetch, verdict intact.

    A list rather than a count, for the reason the recheck response is one: the
    caller needs to know *which* rows to mark as refreshing. Separate from
    `DiscoverProbeRecheckResponse` because the two operations answer differently
    — a recheck blanks the row it returns, a refresh leaves it readable until
    the new answer lands — and one shared model would hide that.
    """

    refreshed: list[str] = Field(default_factory=list)


class DiscoverPostRef(BaseModel):
    channel_name: str = PydanticField(alias="channelName")
    post_id: int = PydanticField(alias="postId")


class DiscoverCandidatesRequest(PostScopeRequest):
    """`PostScopeRequest` plus the signal-kind filter and the cap/scope inputs.

    `channelNames` is re-declared as required: the discovery aggregate is always
    asked about an explicit selection, and the query-string version required it
    too.

    `maxPerChannelMode`/`seed` and `postIds` are what let Discover reproduce the
    two scopes that used to fall back to a second, client-side implementation of
    the same counting rules — the `random` cap and a semantic query
    (IDEA-011 D14).
    """

    channel_names: list[str] = PydanticField(alias="channelNames")
    signals: list[str] | None = None
    max_per_channel_mode: str = PydanticField("latest", alias="maxPerChannelMode")
    seed: int = 0
    post_ids: list[DiscoverPostRef] | None = PydanticField(None, alias="postIds")

    def resolved_post_ids(self) -> list[tuple[str, int]] | None:
        """`None` means "no restriction"; `[]` means "matched nothing"."""
        if self.post_ids is None:
            return None
        return [(ref.channel_name, ref.post_id) for ref in self.post_ids]
