"""Post media contract for Telegram web-view scrape enrichment."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

MediaKind = Literal[
    "photo",
    "video",
    "voice",
    "audio",
    "document",
    "poll",
    "sticker",
    "link_preview",
    "grouped",
]


class LinkPreview(BaseModel):
    title: str | None = None
    description: str | None = None
    site_name: str | None = Field(None, alias="siteName")

    model_config = {"populate_by_name": True}


class PostMedia(BaseModel):
    kinds: list[MediaKind]
    caption: str | None = None
    duration_sec: int | None = Field(None, alias="durationSec")
    thumb_api_path: str | None = Field(None, alias="thumbApiPath")
    views: str | None = None
    reactions: str | None = None
    link_preview: LinkPreview | dict[str, str] | None = Field(None, alias="linkPreview")
    poll: dict[str, Any] | None = None
    grouped_count: int | None = Field(None, alias="groupedCount")
    is_media_only: bool = Field(False, alias="isMediaOnly")

    model_config = {"populate_by_name": True}

    def to_storage_dict(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True)
