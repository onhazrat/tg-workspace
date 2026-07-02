"""TG Summarizer domain models."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, Column, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


def _ms_ts(*, nullable: bool = False) -> Column[int]:
    """Millisecond epoch column (JS Date.now() exceeds PostgreSQL INTEGER)."""
    return Column(BigInteger, nullable=nullable)


def utc_now() -> datetime:
    return datetime.utcnow()


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
    regular_sync_enabled: bool = True
    dynamic_sync_enabled: bool = False
    auto_sync_interval_minutes: int = 60
    dynamic_sync_expected_posts: int = 15
    next_regular_sync_at: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    next_dynamic_sync_at: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    is_frozen: bool = False
    is_unavailable_on_web_view: bool = False
    auto_follow_forwarded: bool = False
    language: str | None = None
    followed_at: int | None = Field(default=None, sa_column=_ms_ts(nullable=True))
    discovered_via: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    history_complete_to_cutoff: bool = True
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
    suggestions: dict[str, list[str]] = Field(default_factory=dict, sa_column=Column(JSON))
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
