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


class ReactionCount(BaseModel):
    """One reaction chip. `emoji` is absent for Telegram's paid (stars) chip."""

    emoji: str | None = None
    # Premium/custom emoji render as `<tg-emoji emoji-id>` with no character.
    custom_emoji_id: str | None = Field(None, alias="customEmojiId")
    count: int
    is_paid: bool | None = Field(None, alias="isPaid")

    model_config = {"populate_by_name": True}


class PostMedia(BaseModel):
    kinds: list[MediaKind]
    caption: str | None = None
    duration_sec: int | None = Field(None, alias="durationSec")
    thumb_api_path: str | None = Field(None, alias="thumbApiPath")
    # `views`/`reactions` stay as Telegram's display strings ("16.4M", and one
    # flattened reaction line). The parsed forms alongside them are what any
    # ranking or comparison should use — "9.74K" does not sort.
    views: str | None = None
    views_count: int | None = Field(None, alias="viewsCount")
    reactions: str | None = None
    reaction_counts: list[ReactionCount] | None = Field(None, alias="reactionCounts")
    reactions_count: int | None = Field(None, alias="reactionsCount")
    link_preview: LinkPreview | dict[str, str] | None = Field(None, alias="linkPreview")
    poll: dict[str, Any] | None = None
    grouped_count: int | None = Field(None, alias="groupedCount")
    is_media_only: bool = Field(False, alias="isMediaOnly")

    model_config = {"populate_by_name": True}

    def to_storage_dict(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True)
