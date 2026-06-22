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
