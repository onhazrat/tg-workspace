"""Request/response models for the channel endpoints.

Second family converted under B2 of `docs/architecture-simplification-plan.md`,
following the pattern set by `app/schemas/summaries.py`.

`channel_to_camel` builds a channel payload in three layers:

1. the 23 columns it always emits,
2. ``effective_channel_fields(group)`` merged in when the channel resolves a
   setting group — the inherited sync/retention settings, and
3. a ``stats`` block, only when the caller passes ``includeStats=true``.

Only layer 1 is declared here. Layers 2 and 3 are conditional, and declaring a
conditional key would serialise it as an explicit ``null`` wherever it is absent
today — changing the wire format for every caller that does not ask for stats.
They flow through ``extra="allow"`` instead. Same call as `SummaryResponse`; see
that module for the reasoning in full.

``bio`` joined them, and for exactly that reason. It is 40% of the channel
list's gzipped bytes, so the list stopped sending it (``GET /channels/bios``
serves it instead) while ``PUT /channels/{id}`` still returns a channel in full.
Left declared, ``model_validate`` on a bio-less row put ``"bio": null`` back on
the wire and claimed 1,662 channels had no bio — a test caught it. Conditional
keys belong in ``extra`` here; that is what the rule above is for.

``ChannelStatsResponse`` *is* declared concretely, because at
``GET /data/channels/{id}/stats`` it is the entire response and every field is
always present.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ChannelStatsResponse(BaseModel):
    """Post aggregates for one channel, as `compute_channel_stats` builds it."""

    model_config = ConfigDict(populate_by_name=True)

    count: int
    min_id: int | None = Field(default=None, alias="minId")
    max_id: int | None = Field(default=None, alias="maxId")
    velocity: float = 0.0


class ChannelResponse(BaseModel):
    """One channel, as `channel_to_camel` builds it.

    Carries the inherited setting-group fields and the optional ``stats`` block
    through ``extra`` — see the module docstring for why they are not declared.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    name: str
    display_name: str | None = Field(default=None, alias="displayName")
    photo_url: str | None = Field(default=None, alias="photoUrl")
    subscribers: str | None = None
    photos: str | None = None
    videos: str | None = None
    files: str | None = None
    links: str | None = None
    start_id: int | None = Field(default=None, alias="startId")
    start_time: int | None = Field(default=None, alias="startTime")
    tags: list[Any] = Field(default_factory=list)
    last_updated: int | None = Field(default=None, alias="lastUpdated")
    next_regular_sync_at: int | None = Field(default=None, alias="nextRegularSyncAt")
    next_dynamic_sync_at: int | None = Field(default=None, alias="nextDynamicSyncAt")
    language: str | None = None
    followed_at: int | None = Field(default=None, alias="followedAt")
    telegram_chat_id: int | None = Field(default=None, alias="telegramChatId")
    discovered_via: dict[str, Any] | None = Field(default=None, alias="discoveredVia")
    history_complete_to_cutoff: bool = Field(
        default=True, alias="historyCompleteToCutoff"
    )
    history_reached_channel_start: bool = Field(
        default=False, alias="historyReachedChannelStart"
    )
    anchor_post_id: int | None = Field(default=None, alias="anchorPostId")
    oldest_stored_post_timestamp: int | None = Field(
        default=None, alias="oldestStoredPostTimestamp"
    )


class ChannelUpsertRequest(BaseModel):
    """Body for ``PUT /data/channels/{id}``.

    Deliberately permissive, like `SummaryUpsertRequest`. `upsert_channel`
    normalises camelCase to snake_case itself, rejects server-managed and
    group-inherited fields with a 400, and writes only recognised
    `Channel.model_fields` — so validation belongs there, not here, and a
    stricter model would turn those 400s into 422s and change the API's error
    contract.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    name: str | None = None
    display_name: str | None = Field(default=None, alias="displayName")
    photo_url: str | None = Field(default=None, alias="photoUrl")
    bio: str | None = None
    subscribers: str | None = None
    start_id: int | None = Field(default=None, alias="startId")
    start_time: int | None = Field(default=None, alias="startTime")
    tags: list[Any] | None = None
    language: str | None = None
    followed_at: int | None = Field(default=None, alias="followedAt")
    telegram_chat_id: int | None = Field(default=None, alias="telegramChatId")
    discovered_via: dict[str, Any] | None = Field(default=None, alias="discoveredVia")

    def to_service_body(self) -> dict[str, Any]:
        """The raw payload as `upsert_channel` expects it.

        Dumped by alias and excluding unset keys: the service distinguishes an
        absent field from an explicit ``null``, and its rejection of
        server-managed fields keys off presence.
        """
        return self.model_dump(by_alias=True, exclude_unset=True)


class SyncMetaEntry(BaseModel):
    """One resource's sync etag, as `get_sync_meta` builds it."""

    etag: str
    updated_at: str = Field(alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)


# --- Bulk channel operations -------------------------------------------------
# These have fully determined shapes (each is built from a dataclass or a
# literal dict), so unlike `ChannelResponse` they are declared closed — no
# `extra="allow"`. That is the point of the rule: use passthrough only where the
# payload genuinely is open.


class BulkReresolveStartIdsResponse(BaseModel):
    """Result of ``POST /data/channels/bulk-reresolve-start-ids``.

    Mirrors `BulkReresolveResult`. The operation is deprecated — `start_id` no
    longer drives sync — hence the always-true `deprecated` flag and `message`.
    """

    model_config = ConfigDict(populate_by_name=True)

    updated: int = 0
    skipped: int = 0
    would_update: int = Field(default=0, alias="wouldUpdate")
    errors: list[dict[str, str]] = Field(default_factory=list)
    deprecated: bool = True
    message: str = ""


class BulkResetSyncResponse(BaseModel):
    """Result of ``POST /data/channels/bulk-reset-sync``. Mirrors `BulkResetSyncResult`."""

    model_config = ConfigDict(populate_by_name=True)

    channels_reset: int = Field(default=0, alias="channelsReset")
    posts_deleted: int = Field(default=0, alias="postsDeleted")
    job_id: str | None = Field(default=None, alias="jobId")
    errors: list[dict[str, str]] = Field(default_factory=list)


class BulkUpdatedResponse(BaseModel):
    """A bulk write that only reports how many rows it touched."""

    updated: int = 0


class BulkSettingGroupResponse(BulkUpdatedResponse):
    """Result of ``PATCH /data/channels/bulk-setting-group``."""

    model_config = ConfigDict(populate_by_name=True)

    setting_group_id: str = Field(alias="settingGroupId")


class BulkChannelTagsResponse(BulkUpdatedResponse):
    """Result of ``PATCH /data/channels/bulk-tags``.

    Returns the rewritten channel rows so the client can refresh without a
    second round-trip.
    """

    channels: list[ChannelResponse] = Field(default_factory=list)
