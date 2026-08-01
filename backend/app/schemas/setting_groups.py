"""Response models for channel setting groups.

Part of B6b — the six `/data` families the B-series had not reached, and the
last untyped domain responses in the API.

A setting group is the unit channels inherit sync behaviour from, which is why
`ChannelResponse` is open: a channel's payload merges the group's fields in.
The group's own payload is not open — it is exactly this table, plus one
conditional key.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class SettingGroupResponse(BaseModel):
    """One setting group.

    **Open for one key.** `channelCount` is attached only by the list endpoint,
    which knows the per-group tally; the create/update endpoints return the group
    without it. Declaring it optional would emit `"channelCount": null` from
    those, so it travels through `extra` — the same rule as `SummaryResponse`.

    `isReserved` is derived from the id rather than stored: the built-in groups
    (Default, Frozen, Restricted) are identified by well-known ids so they cannot
    be renamed out of existence.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    name: str
    is_default: bool = Field(default=False, alias="isDefault")
    is_reserved: bool = Field(default=False, alias="isReserved")
    regular_sync_enabled: bool = Field(default=True, alias="regularSyncEnabled")
    dynamic_sync_enabled: bool = Field(default=False, alias="dynamicSyncEnabled")
    auto_sync_interval_minutes: int = Field(default=0, alias="autoSyncIntervalMinutes")
    dynamic_sync_expected_posts: int = Field(
        default=0, alias="dynamicSyncExpectedPosts"
    )
    auto_follow_forwarded: bool = Field(default=False, alias="autoFollowForwarded")
    is_frozen: bool = Field(default=False, alias="isFrozen")
    is_unavailable_on_web_view: bool = Field(
        default=False, alias="isUnavailableOnWebView"
    )
    include_in_sync_all: bool = Field(default=True, alias="includeInSyncAll")
    include_in_bulk_sync: bool = Field(default=True, alias="includeInBulkSync")
    allow_individual_sync: bool = Field(default=True, alias="allowIndividualSync")
    reset_sync_enabled: bool = Field(default=True, alias="resetSyncEnabled")
    created_at: int = Field(default=0, alias="createdAt")
    updated_at: int = Field(default=0, alias="updatedAt")
