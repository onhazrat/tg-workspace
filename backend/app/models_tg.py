"""TG Summarizer domain models."""

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, Column, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


def _ms_ts(*, nullable: bool = False) -> Column[int]:
    """Millisecond epoch column (JS Date.now() exceeds PostgreSQL INTEGER)."""
    return Column(BigInteger, nullable=nullable)


def utc_now() -> datetime:
    """Naive UTC "now", matching the TIMESTAMP WITHOUT TIME ZONE columns below.

    The tg_* tables store naive timestamps, so this deliberately drops tzinfo
    rather than returning an aware datetime. Equivalent to the deprecated
    datetime.utcnow() it replaces, but without the DeprecationWarning.
    """
    return datetime.now(UTC).replace(tzinfo=None)


class ChannelSettingGroup(SQLModel, table=True):
    __tablename__ = "tg_channel_setting_groups"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    name: str
    is_default: bool = False
    regular_sync_enabled: bool = True
    dynamic_sync_enabled: bool = False
    auto_sync_interval_minutes: int = 60
    dynamic_sync_expected_posts: int = 15
    auto_follow_forwarded: bool = False
    is_frozen: bool = False
    is_unavailable_on_web_view: bool = False
    include_in_sync_all: bool = True
    include_in_bulk_sync: bool = True
    allow_individual_sync: bool = True
    reset_sync_enabled: bool = True
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Channel(SQLModel, table=True):
    __tablename__ = "tg_channels"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    name: str
    display_name: str | None = None
    photo_url: str | None = None
    bio: str | None = None
    subscribers: str | None = None
    photos: str | None = None
    videos: str | None = None
    files: str | None = None
    links: str | None = None
    start_id: int | None = None
    start_time: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    tags: list[Any] = Field(default_factory=list, sa_column=Column(JSON))
    last_updated: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    setting_group_id: str = Field(index=True)
    next_regular_sync_at: int | None = Field(
        default=None, sa_column=_ms_ts(nullable=True)
    )
    next_dynamic_sync_at: int | None = Field(
        default=None, sa_column=_ms_ts(nullable=True)
    )
    language: str | None = None
    followed_at: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    telegram_chat_id: int | None = Field(
        default=None, sa_column=Column(BigInteger, nullable=True)
    )
    discovered_via: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    history_complete_to_cutoff: bool = True
    # Set once a backward walk paginates off the beginning of the channel. Such
    # a channel is fully covered even when its oldest post is newer than the
    # cutoff -- there is no older history to fetch. Without this, channels
    # younger than the retention window stay `history_complete_to_cutoff=False`
    # forever and are re-backfilled by auto-sync on every run.
    history_reached_channel_start: bool = False
    anchor_post_id: int | None = None
    oldest_stored_post_timestamp: int | None = Field(
        default=None, sa_column=_ms_ts(nullable=True)
    )
    updated_at: datetime = Field(default_factory=utc_now)


class ChannelFollow(SQLModel, table=True):
    """One User's relation to one Channel (ticket 04, plan step A1).

    The Channel and its Posts are a shared corpus — `Channel.id` is the handle
    and `Post` is unique per `(channel_name, post_id)`, so one scrape serves
    every follower. What is *not* shared is the relation: which Channels you
    watch, what you tagged them, when you started, and when yours next syncs.
    Those columns sit on `tg_channels` today, where a second follower of the
    same handle would have to overwrite the first one's values to have any of
    their own.

    Composite natural key `(user_id, channel_id)`, so following twice is
    impossible by construction rather than by a check somebody remembers, and
    "does this user follow this channel" is a primary-key hit. Both foreign
    keys cascade: deleting an account takes its follows with it, and deleting a
    Channel takes the follows of a row that no longer exists. `ix_..._channel_id`
    serves the other direction — "who follows this channel", which retention and
    the scheduler ask and which the PK's leading column cannot answer.

    **Nothing reads this table yet.** Ticket 04 creates it, backfills it, and
    dual-writes it from every Channel-creation path; the read paths adopt it in
    tickets 15-16 and `Channel`'s copies of these columns are dropped in ticket
    22. Until then both rows carry the value and the Channel's is authoritative.

    `next_sync_at` has no counterpart on `Channel` and is deliberately here from
    day one. The most-eager-wins scheduling the plan defers (decision 39) needs
    exactly this column, and adding it later means a migration on a table that
    by then has a row per user per channel.
    """

    __tablename__ = "tg_channel_follows"

    user_id: uuid.UUID = Field(
        foreign_key="user.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    channel_id: str = Field(
        foreign_key="tg_channels.id",
        primary_key=True,
        index=True,
        ondelete="CASCADE",
    )

    #: The per-User fields currently duplicated on `Channel`, dropped there in
    #: ticket 22. `setting_group_id` is nullable here and not on `Channel`:
    #: a follow created before its group is resolved is a real state, and
    #: inventing a group id to satisfy a NOT NULL would put a lie in the row.
    setting_group_id: str | None = Field(default=None)
    followed_at: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    tags: list[Any] = Field(default_factory=list, sa_column=Column(JSON))
    start_id: int | None = None
    start_time: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    discovered_via: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))

    #: This follower's own next sync time. See the class docstring.
    next_sync_at: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))

    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Post(SQLModel, table=True):
    __tablename__ = "tg_posts"
    __table_args__ = (UniqueConstraint("channel_name", "post_id"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    channel_name: str = Field(index=True)
    post_id: int
    text: str = Field(sa_column=Column(Text))
    date: str = ""
    timestamp: int = Field(default=0, sa_column=_ms_ts())
    forwarded_from: str | None = None
    forwarded_from_name: str | None = None
    is_anchor: bool = Field(default=False, index=True)
    retrieved_at: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    retrieval_job_id: str | None = None
    retrieval_pass: str | None = None
    retrieval_source: str | None = None
    media: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    # Telegram channel links found in the post body (masked hrefs the plain-text
    # extraction discards). Shape: [{"url": str, "channel": str}]
    links: list[Any] | None = Field(default=None, sa_column=Column(JSON))
    # The post this one replies to. `reply_to["text"]` is Telegram's truncated
    # excerpt of the parent, not its full body.
    # Shape: {"channel": str, "authorName": str, "text": str, "url": str}
    reply_to_post_id: int | None = Field(default=None, index=True)
    reply_to: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utc_now)


class PostSyncState(SQLModel, table=True):
    __tablename__ = "tg_post_sync_state"
    __table_args__ = (UniqueConstraint("channel_name", "post_id"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    channel_name: str = Field(index=True)
    post_id: int
    state: str = "confirmed_gap"
    confirmed_at: int = Field(default=0, sa_column=_ms_ts())
    confirmed_job_id: str | None = None
    updated_at: datetime = Field(default_factory=utc_now)


class Summary(SQLModel, table=True):
    __tablename__ = "tg_summaries"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    text: str = Field(sa_column=Column(Text))
    channels: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    start_date: int = Field(default=0, sa_column=_ms_ts())
    end_date: int = Field(default=0, sa_column=_ms_ts())
    language: str = "English"
    model: str | None = None
    post_count: int | None = None
    timestamp: int = Field(default=0, sa_column=_ms_ts())
    #: Open bag of small UI flags (`isStarred`, `autoPublish`, `note`, …).
    #: The corpus-sized fields are **not** here — see `SummaryPayload`.
    extra: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    # Derived from SummaryPayload and maintained on write, so the list
    # projection never has to open the payload table. The list surfaces only
    # ever showed a count and a truncated preview.
    chat_message_count: int = 0
    prompt_excerpt: str | None = None
    updated_at: datetime = Field(default_factory=utc_now)


class SummaryPayload(SQLModel, table=True):
    """The corpus-sized half of a `Summary`, split off so listing skips it.

    `citedPosts` (whole Post objects), `promptText` (a serialized post corpus)
    and `chatMessages` (an entire conversation) used to live in
    `Summary.extra`. TOAST is all-or-nothing per value, so reading *any* key of
    `extra` detoasted the lot: one 49-row page carried 26 MB compressed
    (48 MB of it `promptText`) to return 1.15 MB, and the endpoint took 2.69 s
    on every tab load. Pushing the projection into SQL does not help — a
    measured `extra::jsonb - 'citedPosts' - …` still costs 2.86 s, because the
    detoast and parse happen either way.

    As its own table the heavy half is simply not in the list query's FROM
    clause, which is the point: this is **fail-closed** where a deferred column
    would be fail-open. `select(Summary)` cannot regress into reading it.

    Unlike `SyncLogPayload`, which exists so disposable telemetry can be
    truncated, this is user content — the migration copies it across and the
    downgrade merges it back. It follows that precedent on the other points
    though: no foreign key, so the table stays droppable and truncatable, and
    `app.services.summaries` cleans up explicitly rather than via a cascade.
    """

    __tablename__ = "tg_summary_payloads"

    summary_id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    cited_posts: dict[str, Any] | list[Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )
    # Text, not JSON: it is ~90% of the weight and the only heavy field the
    # search clause reads, so keeping it in its own column means an ILIKE
    # detoasts the prompt bodies alone and leaves citedPosts untouched.
    prompt_text: str | None = Field(default=None, sa_column=Column(Text))
    chat_messages: dict[str, Any] | list[Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )
    updated_at: datetime = Field(default_factory=utc_now)


class ChatSession(SQLModel, table=True):
    """A saved conversation — a first-class artifact, not a summary in disguise.

    A chat used to be a `Summary` whose `text` began with the literal string
    `"Chat: "`, with the transcript in `SummaryPayload.chat_messages`. That
    encoded the *kind* of an artifact in a prefix of its body text: the history
    list, the type filter and the restore path each re-derived "is this a chat?"
    from `str.startswith`, and a summary that legitimately began with those six
    characters was one. Worse, a chat started while a summary was open patched
    *that summary's* transcript instead of creating a row, so it never appeared
    in history as its own thing.

    Modelled column-for-column on `Summary`, deliberately: the two are siblings,
    they list side by side, and every lesson `Summary` has already paid for
    applies unchanged. In particular the transcript is **not** here and **not**
    in `extra` — see `ChatSessionPayload`.

    **There is no link to a summary, and that is the point.** Chat mode
    `full_scope` never read one: the prompt is assembled from the selected
    channels, the date range and the post filters, exactly as a summary's is. A
    chat depends on its scope and nothing else. If "chats about this summary" is
    ever wanted it is a link table, added when something needs it.
    """

    __tablename__ = "tg_chat_sessions"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    #: Derived from the first user message on write. A column rather than a
    #: computed-on-read value so the list projection never opens the payload
    #: table for it. This is what replaces the `"Chat: "` prefix — it stores the
    #: *label*, where the prefix stored the kind.
    title: str = Field(default="", sa_column=Column(Text))
    channels: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    start_date: int = Field(default=0, sa_column=_ms_ts())
    end_date: int = Field(default=0, sa_column=_ms_ts())
    language: str = "English"
    model: str | None = None
    #: `"full_scope"` (every post in scope) or `"semantic"` (only the posts a
    #: vector search retrieved). Named for what they do: these were once
    #: `"summary"` and `"history"`, neither of which was true — the first read
    #: no summary and the second had nothing to do with the History tab.
    mode: str = "full_scope"
    post_count: int | None = None
    timestamp: int = Field(default=0, sa_column=_ms_ts())
    #: Open bag of small UI flags (`isStarred`, `note`, `postSearch`,
    #: `semanticSearchQuery`, …), exactly as on `Summary`. Conditional keys flow
    #: through here and are deliberately **not** declared: a declared optional
    #: field serialises as an explicit `null` where the key is absent today.
    extra: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    #: Derived from `ChatSessionPayload` and maintained on write, so the list
    #: projection never has to open the payload table. Mirrors
    #: `Summary.chat_message_count`.
    message_count: int = 0
    updated_at: datetime = Field(default_factory=utc_now)


class ChatSessionPayload(SQLModel, table=True):
    """The corpus-sized half of a `ChatSession`, split off so listing skips it.

    Same split, same reason, same measurements as `SummaryPayload` — a
    transcript is a whole conversation, and the history list renders a count and
    a one-line title of it. It arrives here already knowing the answer: these
    exact values sat in `Summary.extra` under `chatMessages`, cost a measured
    26 MB per 49-row page together with their neighbours, and were moved into
    `tg_summary_payloads` for that reason. Promoting chats to their own
    aggregate must not walk that back, which is what a `messages` column on
    `tg_chat_sessions` would be.

    A **table** rather than a deferred column because a table is fail-closed:
    `select(ChatSession)` cannot read what is not in its FROM clause, where a
    forgotten `defer()` restores the full cost silently.

    Like `SummaryPayload` this is user content, not disposable telemetry, so the
    downgrade merges it back. And like both existing payload tables it has **no
    foreign key**, so it stays droppable and truncatable, and
    `app.services.chat_sessions` cleans up explicitly rather than via a cascade.
    """

    __tablename__ = "tg_chat_session_payloads"

    chat_session_id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    #: `[{"role": "user" | "model", "text": str, "sources"?: [...]}]`
    messages: list[Any] | None = Field(default=None, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utc_now)


class DiscoverReport(SQLModel, table=True):
    """A saved Discover run: the candidates found for a scope at a point in time.

    Modelled on `Summary` — a report is an artifact the user generates and keeps,
    not a view that recomputes. The scope columns are a *snapshot* of the
    Channels/Posts selections at generate time, so changing those selections
    later cannot alter or invalidate an existing report (IDEA-011 W1).

    `candidates` deliberately stores the full result including the long
    single-reference tail, so `minTotal` stays a view filter over saved data
    rather than something applied destructively at save time.

    `isFollowed` is NOT stored. It is derived against the live `tg_channels` set
    whenever a report is read, so a saved report self-corrects as channels are
    followed. Counts are historical; follow state is live.
    """

    __tablename__ = "tg_discover_reports"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)

    # --- scope snapshot (inputs, frozen at generate time) ---
    channels: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    start_date: int = Field(default=0, sa_column=_ms_ts())
    end_date: int = Field(default=0, sa_column=_ms_ts())
    signals: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    keyword: str | None = None
    forwarded: str = "all"
    media: str = "all"
    max_per_channel: int = 0
    max_per_channel_mode: str = "latest"
    # Seed for the `random` cap. Stored so the scope snapshot is complete: the
    # same seed selects the same posts, which is what makes a `random`-capped
    # report reproducible rather than a one-off.
    seed: int = 0
    # How many posts the scope was explicitly restricted to — a semantic query
    # passes its matches in. `None` means unrestricted. The count rather than
    # the ids: enough to explain the scope without another corpus-sized column.
    scoped_post_count: int | None = None

    # --- result ---
    candidates: list[Any] = Field(default_factory=list, sa_column=Column(JSON))
    scope_counts: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    posts_in_scope: int = 0
    #: `len(candidates)`, maintained on write.
    #:
    #: Without it the list projection has to read `candidates` — a corpus-sized
    #: JSON column holding the whole single-reference tail — in order to ship one
    #: integer. `report_to_camel_light` did exactly that until this column
    #: existed, detoasting every report on the page to compute a `len()`. This is
    #: the same trick `Summary.chat_message_count` plays one table over.
    candidate_count: int = 0

    timestamp: int = Field(default=0, sa_column=_ms_ts())
    #: Open bag of small UI flags (`isStarred`, `note`). Added when History
    #: became one list over all four artifact kinds: a starred-only filter that
    #: worked on summaries and chats but silently skipped tag runs and reports
    #: is worse than either having the filter or not.
    extra: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utc_now)


class DiscoverIgnoredChannel(SQLModel, table=True):
    """A Discover candidate the operator has decided against following.

    Without this, every rerun re-surfaces everything already rejected: the good
    candidates get followed and drop out of the unfollowed view, so the report
    fills up with rejects and gets *less* useful the more it is used
    (IDEA-011 D8).

    Keyed by the normalized (lowercased, `@`-stripped) handle, matching how
    `discover.py` compares handles, so a dismissal survives a candidate
    reappearing with different casing.

    Deliberately reversible and visible: dismissals are listed under the
    "Ignored" filter and can be undone. A hidden, unreviewable blocklist would
    be worse than none — a channel rejected once could never be reconsidered.
    """

    __tablename__ = "tg_discover_ignored"

    handle: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    reason: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class DiscoverHandleProbe(SQLModel, table=True):
    """What one fetch of `t.me/<handle>` told us about a handle (IDEA-011 D9).

    Most Discover candidates cannot be followed at all: bots, personal
    accounts, groups, and private or deleted channels are all referenced from
    posts exactly the way real channels are, so the report asks the operator to
    triage rows that were never actionable. Probing resolves that once per
    handle.

    **Global and separate from `DiscoverIgnoredChannel` by design.** A dismissal
    is a judgement ("not interesting to me"); a probe is a fact about the handle
    ("cannot be followed by anyone"). Merging them would make an automated
    verdict indistinguishable from a deliberate one in the UI, and would let a
    misprobe silently masquerade as something the operator chose.

    Keyed by the normalized handle, like the dismiss table, so both join onto
    candidate names the same way.

    ## This table is also the work queue

    A row with `status="unknown"` *is* a pending work item, so the cache and the
    queue are deliberately the same row rather than two tables that could
    disagree about whether a handle still needs fetching. `priority` and
    `retry_after` are what make the queue drainable without being handed a
    candidate list — which is the whole reason probing can run as a scheduled
    backend job instead of being driven from the browser.

    ## Why a verdict is never written from a failed fetch

    `status` is `ok` or `unavailable` only when a Telegram page actually parsed.
    A timeout, an HTTP error, a proxy returning a block page — anything that
    leaves us without a real answer — records `unknown` and increments
    `attempts` instead. The whole premise of this table is that a handle is
    probed once and the answer cached indefinitely, so caching a *failure* as a
    verdict would permanently hide a real channel from every future report, with
    nothing on screen to suggest anything went wrong.
    """

    __tablename__ = "tg_discover_probes"

    handle: str = Field(primary_key=True)

    #: `ok` (public channel we can scrape) | `unavailable` (exists but cannot be
    #: followed) | `unknown` (no conclusive answer yet).
    status: str = Field(default="unknown", index=True)

    #: Best-effort: `channel` | `group` | `bot` | `user` | `unknown`. Secondary
    #: to `status` — it sharpens the wording, never the filtering, because it is
    #: HTML heuristics where `status` is a structural fact.
    kind: str = Field(default="unknown")

    display_name: str | None = None
    bio: str | None = None
    #: Raw text as Telegram renders it ("12.3K"), not parsed into an int: the
    #: exact number is not worth a fragile locale-aware parse.
    subscribers: str | None = None
    photo_url: str | None = None
    latest_id: int = 0

    #: Consecutive inconclusive fetches. Drives retry backoff and is reset on a
    #: conclusive answer.
    attempts: int = 0
    last_error: str | None = None

    #: Drain order — lower first. Set from the candidate's rank in the report
    #: that enqueued it, so the rows the operator is actually reading resolve
    #: first instead of after the long single-reference tail. A handle enqueued
    #: by several reports keeps the best (lowest) rank it ever had. The default
    #: is a large sentinel rather than 0 so anything enqueued with a real rank
    #: sorts ahead of rows that predate this column.
    #:
    #: Not indexed on its own — nothing queries priority alone. The composite
    #: `ix_tg_discover_probes_queue` on `(status, priority)` is what serves the
    #: dequeue, and it lives in the migration, as the other composite indexes in
    #: this schema do.
    priority: int = Field(default=1_000_000)

    #: When an inconclusive handle becomes eligible for another attempt.
    #: Materialized from `attempts` at write time rather than recomputed per row
    #: at read time, which is what lets the dequeue be a single indexable WHERE.
    #: `None` means "due now".
    retry_after: datetime | None = None

    #: When a *conclusive* answer was last recorded. `None` while only failures
    #: have happened, which is what distinguishes "never resolved" from "known".
    checked_at: datetime | None = None
    #: Every attempt, conclusive or not — the backoff clock.
    attempted_at: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)


class TagRun(SQLModel, table=True):
    __tablename__ = "tg_tag_runs"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    status: str = "pending"
    source: str = "generated"
    mode: str = "add"
    channels: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    start_date: int = Field(default=0, sa_column=_ms_ts())
    end_date: int = Field(default=0, sa_column=_ms_ts())
    post_count: int | None = None
    model: str | None = None
    prompt_text: str | None = Field(default=None, sa_column=Column(Text))
    response_text: str | None = Field(default=None, sa_column=Column(Text))
    all_tags_snapshot: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    channel_context_options: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    suggestions: dict[str, list[str]] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    apply_result: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    error: str | None = Field(default=None, sa_column=Column(Text))
    #: Open bag of small UI flags (`isStarred`, `note`) — see the note on
    #: `DiscoverReport.extra` for why all four artifact kinds have one.
    extra: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: int = Field(default=0, sa_column=_ms_ts())
    updated_at_ms: int = Field(default=0, sa_column=_ms_ts())
    updated_at: datetime = Field(default_factory=utc_now)


class BotCredential(SQLModel, table=True):
    __tablename__ = "tg_bot_credentials"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    name: str
    token_encrypted: str
    username: str | None = None
    photo_url: str | None = None
    last_validated: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    updated_at: datetime = Field(default_factory=utc_now)


class ChatDestination(SQLModel, table=True):
    __tablename__ = "tg_chat_destinations"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    name: str
    chat_id: str
    updated_at: datetime = Field(default_factory=utc_now)


class PostEmbedding(SQLModel, table=True):
    __tablename__ = "tg_post_embeddings"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    channel_name: str
    post_id: int
    vector: list[float] = Field(sa_column=Column(JSON))
    text: str = Field(sa_column=Column(Text))
    provider: str = "gemini"
    model: str = ""
    dimensions: int = 0
    updated_at: datetime = Field(default_factory=utc_now)


class PostTranslation(SQLModel, table=True):
    __tablename__ = "tg_post_translations"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    channel_name: str
    post_id: int
    language: str
    translated_text: str = Field(sa_column=Column(Text))
    timestamp: int = Field(default=0, sa_column=_ms_ts())
    updated_at: datetime = Field(default_factory=utc_now)


class AppSetting(SQLModel, table=True):
    """Deployment-wide settings: one row per key, shared by every account.

    Ticket 06 made this the *global* half of a two-table split. `key` alone is
    the primary key because there is one answer per deployment — which jobs
    run, how fast the scheduler ticks, which proxies to use. What an account
    may set for itself lives in `UserSetting` instead, and
    `services/settings_registry.py` says which key is which.

    `user_id` survives as a "last written by" stamp and no longer scopes
    anything; ticket 22 drops it. It was never a scope: `key` being the whole
    primary key meant two accounts could not hold different values, so the
    column only ever recorded who saved last.
    """

    __tablename__ = "tg_app_settings"

    key: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    value: dict[str, Any] = Field(sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utc_now)


class UserSetting(SQLModel, table=True):
    """One account's own settings: one row per key *per User* (ticket 06).

    The composite primary key `(key, user_id)` is the entire point. In the old
    single table `key` alone was the primary key, so a second account saving
    its start-time preference overwrote the first account's — and, because
    every writer read-modify-wrote the whole JSON blob, it also wrote back
    whatever scheduler counters that browser last read.

    A separate table rather than a nullable owner on `AppSetting`, because a
    nullable owner is the ambiguity `operator.py` had: `user_id IS NULL` reads
    identically as "belongs to the deployment" and "nobody stamped it", and
    those two have opposite consequences once ticket 21 flips enforcement.

    The foreign key cascades, following `ChannelFollow`: deleting an account
    takes its settings with it, so a row cannot outlive its owner.
    """

    __tablename__ = "tg_user_settings"

    key: str = Field(primary_key=True)
    user_id: uuid.UUID = Field(
        foreign_key="user.id",
        primary_key=True,
        index=True,
        ondelete="CASCADE",
    )
    value: dict[str, Any] = Field(sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utc_now)


class PublishLog(SQLModel, table=True):
    __tablename__ = "tg_publish_logs"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    summary_id: str
    bot_id: str
    bot_name: str
    chat_id: str
    chat_name: str
    status: str
    error: str | None = None
    timestamp: int = Field(default=0, sa_column=_ms_ts())
    full_request: dict[str, Any] | list[Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )
    full_response: dict[str, Any] | list[Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )
    text_sent: str | None = None
    updated_at: datetime = Field(default_factory=utc_now)


class SyncLog(SQLModel, table=True):
    __tablename__ = "tg_sync_logs"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    channel_name: str
    status: str
    posts_count: int = 0
    new_latest_id: int | None = None
    error: str | None = None
    timestamp: int = Field(default=0, sa_column=_ms_ts())
    source: str = ""
    updated_at: datetime = Field(default_factory=utc_now)


class SyncLogPayload(SQLModel, table=True):
    """Request/response bodies for `SyncLog`, split off so they can be reclaimed.

    These are the bulk of a sync log — full_response is ~17KB/row and up to 3MB
    — and they live apart from `tg_sync_logs` because a bulk DELETE cannot give
    disk back. PostgreSQL only marks deleted rows dead; the space returns to the
    table's freelist for reuse, not to the OS. Actually shrinking a table needs
    VACUUM FULL, which rewrites it into a new file and so wants free space equal
    to the table it is rewriting — exactly what is missing once logs have filled
    the disk. As its own table it can be truncated instead: instant, no
    headroom required, and every log row (status, error, counts) survives.

    Deliberately has no foreign key to tg_sync_logs. The table has to stay
    droppable and truncatable at any moment, so a missing row here means
    "payload no longer retained" rather than a broken log, and the delete paths
    in `app.services.logs` clean up explicitly instead of relying on a cascade.
    """

    __tablename__ = "tg_sync_log_payloads"

    sync_log_id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    # Denormalised from tg_sync_logs: payloads expire on their own, shorter
    # horizon, and carrying the age here keeps that sweep a single-table bulk
    # DELETE rather than a join across the whole log table.
    timestamp: int = Field(default=0, sa_column=_ms_ts())
    full_request: dict[str, Any] | list[Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )
    full_response: dict[str, Any] | list[Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )
    updated_at: datetime = Field(default_factory=utc_now)


class LLMLog(SQLModel, table=True):
    __tablename__ = "tg_llm_logs"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    model: str
    prompt: str = Field(sa_column=Column(Text))
    response: str = Field(sa_column=Column(Text))
    system_instruction: str | None = Field(default=None, sa_column=Column(Text))
    model_config_json: dict[str, Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )
    full_request: dict[str, Any] | list[Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )
    full_response: dict[str, Any] | list[Any] | None = Field(
        default=None, sa_column=Column(JSON)
    )
    tokens: int | None = None
    duration: float | None = None
    status: str
    error: str | None = None
    timestamp: int = Field(default=0, sa_column=_ms_ts())
    log_type: str = "summary"
    updated_at: datetime = Field(default_factory=utc_now)


class EmbeddingLog(SQLModel, table=True):
    __tablename__ = "tg_embedding_logs"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    text_count: int = 0
    tokens_estimated: int | None = None
    duration: float = 0
    status: str
    error: str | None = None
    timestamp: int = Field(default=0, sa_column=_ms_ts())
    updated_at: datetime = Field(default_factory=utc_now)


class NetworkLog(SQLModel, table=True):
    __tablename__ = "tg_network_logs"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    url: str
    method: str
    status: str
    status_code: int | None = None
    error: str | None = None
    duration: float = 0
    timestamp: int = Field(default=0, sa_column=_ms_ts())
    source: str = ""
    proxy_used: str | None = None
    attempts: int | None = None
    telemetry: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utc_now)


class SyncJob(SQLModel, table=True):
    __tablename__ = "tg_sync_jobs"

    id: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
    status: str = "pending"
    source: str = ""
    #: Which shape of sync this is — `individual`, `bulk`, `sync_all`,
    #: `recheck_restricted`, `auto`. Persisted since ticket 10, because the
    #: process that *runs* the job is no longer the one that created it and can
    #: only learn this from the row. It decides two things, and getting it wrong
    #: is silent in both: the Budget the Requests are charged against
    #: (`quota.budget_for_sync_mode`) and whether a Channel's setting group
    #: permits the operation at all (`channel_allows_sync_operation`). Before
    #: this column the worker rehydrated every job as `auto`.
    sync_mode: str = Field(default="auto")
    channels: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: int = Field(default=0, sa_column=_ms_ts())
    finished_at: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    updated_at: datetime = Field(default_factory=utc_now)


class SyncMeta(SQLModel, table=True):
    __tablename__ = "tg_sync_meta"

    resource: str = Field(primary_key=True)
    etag: str
    updated_at: datetime = Field(default_factory=utc_now)


class QuotaUsage(SQLModel, table=True):
    """What one User spent on one Budget on one UTC day (ticket 08).

    The ledger, and for now only that: nothing reads it to decide anything.
    Ticket 23 reads it at enqueue to pick a lane and ticket 24 to refuse at the
    ceiling, so the shape here is the shape those questions need — "what has
    this User spent today, on this Budget" is a primary-key hit.

    `day` is a date rather than a timestamp because the reset is UTC midnight
    (decision 16). A timestamp would move the boundary into every reader, and
    the readers would eventually disagree about it.

    `requests` counts HTTP Requests to the Telegram web view, not channel syncs
    — one sync is anywhere between one request and fifty, so a limit denominated
    in syncs is not a load control (decision 15). `services/quota.py` is the
    sole writer and `core/request_meter.py` does the counting.

    **Never pruned.** A few hundred rows a year per active account, and it is
    the only record an Admin has to set a limit from; `run_retention_cleanup`
    and `stats.clear_table` both work from explicit inventories this table is
    deliberately absent from. The foreign key still cascades, as
    `ChannelFollow` and `UserSetting` do: an account's ledger going with the
    account is that account ceasing to exist, not a prune.
    """

    __tablename__ = "tg_quota_usage"

    user_id: uuid.UUID = Field(
        foreign_key="user.id",
        primary_key=True,
        ondelete="CASCADE",
    )
    #: UTC calendar day. The leading PK column is `user_id`, so the Admin view's
    #: "everyone, on this day" needs an index of its own — the PK cannot serve a
    #: predicate on its second column.
    day: date = Field(primary_key=True, index=True)
    #: One of `services/quota.Budget`. Stored as its string value, so this is a
    #: persisted format: renaming a Budget needs a migration, not just an edit.
    budget: str = Field(primary_key=True)

    requests: int = 0

    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
