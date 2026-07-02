"""Request/response schemas for TG data API routes."""

from pydantic import BaseModel, Field


class BulkReresolveStartIdsRequest(BaseModel):
    dry_run: bool = Field(default=False, alias="dryRun")
    limit: int | None = None
    channel_ids: list[str] | None = Field(default=None, alias="channelIds")
    auto_follow_only: bool = Field(default=False, alias="autoFollowOnly")

    model_config = {"populate_by_name": True}


class BulkResetSyncRequest(BaseModel):
    confirm: bool = False
    channel_ids: list[str] | None = Field(default=None, alias="channelIds")
    auto_follow_only: bool = Field(default=False, alias="autoFollowOnly")

    model_config = {"populate_by_name": True}


class BulkSyncSettingsRequest(BaseModel):
    channel_ids: list[str] | None = Field(default=None, alias="channelIds")
    regular_sync_enabled: bool | None = Field(default=None, alias="regularSyncEnabled")
    dynamic_sync_enabled: bool | None = Field(default=None, alias="dynamicSyncEnabled")
    auto_sync_interval_minutes: int | None = Field(
        default=None, alias="autoSyncIntervalMinutes"
    )
    dynamic_sync_expected_posts: int | None = Field(
        default=None, alias="dynamicSyncExpectedPosts"
    )

    model_config = {"populate_by_name": True}


class BulkChannelTagUpdate(BaseModel):
    channel_id: str = Field(alias="channelId")
    tags: list[dict[str, object]]

    model_config = {"populate_by_name": True}


class BulkChannelTagsRequest(BaseModel):
    updates: list[BulkChannelTagUpdate]

    model_config = {"populate_by_name": True}
