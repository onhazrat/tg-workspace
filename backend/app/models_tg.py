"""TG Summarizer domain models."""

import uuid
from datetime import UTC, datetime
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
    extra: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
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

    timestamp: int = Field(default=0, sa_column=_ms_ts())
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
    __tablename__ = "tg_app_settings"

    key: str = Field(primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, index=True)
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
    channels: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: int = Field(default=0, sa_column=_ms_ts())
    finished_at: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    updated_at: datetime = Field(default_factory=utc_now)


class SyncMeta(SQLModel, table=True):
    __tablename__ = "tg_sync_meta"

    resource: str = Field(primary_key=True)
    etag: str
    updated_at: datetime = Field(default_factory=utc_now)
