"""Request/response schemas for TG data API routes."""

from typing import Literal

from pydantic import BaseModel, Field


class DiscoveredViaPayload(BaseModel):
    channel_name: str = Field(alias="channelName")
    post_id: int = Field(alias="postId")
    timestamp: int

    model_config = {"populate_by_name": True}


class BulkFollowChannelEntry(BaseModel):
    name: str
    discovered_via: DiscoveredViaPayload | None = Field(
        default=None, alias="discoveredVia"
    )

    model_config = {"populate_by_name": True}


class BulkFollowRequest(BaseModel):
    """No `proxies` field — see `schemas/telegram.ProxyConfig` (ADR-012)."""

    channels: list[BulkFollowChannelEntry]
    proxy_enabled: bool = Field(False, alias="proxyEnabled")
    tor_auto_rotate: bool = Field(False, alias="torAutoRotate")
    tor_rotation_threshold: int = Field(10, alias="torRotationThreshold")

    model_config = {"populate_by_name": True}


class BulkFollowStartResponse(BaseModel):
    follow_job_id: str = Field(..., alias="followJobId")

    model_config = {"populate_by_name": True}


class FollowChannelResultResponse(BaseModel):
    name: str
    status: Literal[
        "pending", "running", "added", "unavailable", "skipped", "error", "cancelled"
    ]
    reason: str | None = None
    error: str | None = None

    model_config = {"populate_by_name": True}


class BulkFollowJobStatusResponse(BaseModel):
    follow_job_id: str = Field(..., alias="followJobId")
    status: str
    source: str
    total: int
    completed: int
    added: int
    skipped: int
    unavailable: int
    failed: int
    results: list[FollowChannelResultResponse]
    sync_job_id: str | None = Field(None, alias="syncJobId")
    created_at: int = Field(..., alias="createdAt")
    finished_at: int | None = Field(None, alias="finishedAt")

    model_config = {"populate_by_name": True}


class CancelBulkFollowResponse(BaseModel):
    follow_job_id: str = Field(..., alias="followJobId")
    status: str

    model_config = {"populate_by_name": True}


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


class BulkChannelSettingGroupRequest(BaseModel):
    channel_ids: list[str] = Field(alias="channelIds")
    setting_group_id: str = Field(alias="settingGroupId")

    model_config = {"populate_by_name": True}


class SettingGroupWriteRequest(BaseModel):
    name: str | None = None
    regular_sync_enabled: bool | None = Field(default=None, alias="regularSyncEnabled")
    dynamic_sync_enabled: bool | None = Field(default=None, alias="dynamicSyncEnabled")
    auto_sync_interval_minutes: int | None = Field(
        default=None, alias="autoSyncIntervalMinutes"
    )
    dynamic_sync_expected_posts: int | None = Field(
        default=None, alias="dynamicSyncExpectedPosts"
    )
    auto_follow_forwarded: bool | None = Field(
        default=None, alias="autoFollowForwarded"
    )
    is_frozen: bool | None = Field(default=None, alias="isFrozen")
    is_unavailable_on_web_view: bool | None = Field(
        default=None, alias="isUnavailableOnWebView"
    )
    include_in_sync_all: bool | None = Field(default=None, alias="includeInSyncAll")
    include_in_bulk_sync: bool | None = Field(default=None, alias="includeInBulkSync")
    allow_individual_sync: bool | None = Field(
        default=None, alias="allowIndividualSync"
    )
    reset_sync_enabled: bool | None = Field(default=None, alias="resetSyncEnabled")

    model_config = {"populate_by_name": True}
