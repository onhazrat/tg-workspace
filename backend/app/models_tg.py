"""TG Summarizer domain models."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Column, JSON, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.utcnow()


class Channel(SQLModel, table=True):
    __tablename__ = "tg_channels"

    id: str = Field(primary_key=True)
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
    start_time: int | None = None
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    last_updated: int | None = None
    is_frozen: bool = False
    is_unavailable_on_web_view: bool = False
    language: str | None = None
    followed_at: int | None = None
    discovered_via: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utc_now)


class Post(SQLModel, table=True):
    __tablename__ = "tg_posts"
    __table_args__ = (UniqueConstraint("channel_name", "post_id"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    channel_name: str = Field(index=True)
    post_id: int
    text: str = Field(sa_column=Column(Text))
    date: str = ""
    timestamp: int = 0
    forwarded_from: str | None = None
    forwarded_from_name: str | None = None
    updated_at: datetime = Field(default_factory=utc_now)


class Summary(SQLModel, table=True):
    __tablename__ = "tg_summaries"

    id: str = Field(primary_key=True)
    text: str = Field(sa_column=Column(Text))
    channels: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    start_date: int = 0
    end_date: int = 0
    language: str = "English"
    model: str | None = None
    post_count: int | None = None
    timestamp: int = 0
    extra: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utc_now)


class BotCredential(SQLModel, table=True):
    __tablename__ = "tg_bot_credentials"

    id: str = Field(primary_key=True)
    name: str
    token_encrypted: str
    username: str | None = None
    photo_url: str | None = None
    last_validated: int | None = None
    updated_at: datetime = Field(default_factory=utc_now)


class ChatDestination(SQLModel, table=True):
    __tablename__ = "tg_chat_destinations"

    id: str = Field(primary_key=True)
    name: str
    chat_id: str
    updated_at: datetime = Field(default_factory=utc_now)


class PostEmbedding(SQLModel, table=True):
    __tablename__ = "tg_post_embeddings"

    id: str = Field(primary_key=True)
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
    channel_name: str
    post_id: int
    language: str
    translated_text: str = Field(sa_column=Column(Text))
    timestamp: int = 0
    updated_at: datetime = Field(default_factory=utc_now)


class AppSetting(SQLModel, table=True):
    __tablename__ = "tg_app_settings"

    key: str = Field(primary_key=True)
    value: dict[str, Any] = Field(sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utc_now)


class SyncMeta(SQLModel, table=True):
    __tablename__ = "tg_sync_meta"

    resource: str = Field(primary_key=True)
    etag: str
    updated_at: datetime = Field(default_factory=utc_now)
