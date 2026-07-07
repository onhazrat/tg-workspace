"""Channel setting groups — strict inheritance for sync/operational fields."""

from __future__ import annotations

import time
import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, col, func, select

from app.jobs.settings import load_sync_settings
from app.models_tg import Channel, ChannelSettingGroup
from app.services.serialization import normalize_body, to_camel, to_snake
from app.services.sync_schedule import (
    compute_next_dynamic_sync_at_from_last_updated,
    compute_next_regular_sync_at_from_last_updated,
)

def _velocity_from_timestamps(timestamps: list[int]) -> float:
    from app.services.channels import _velocity_from_timestamps as velocity_fn

    return velocity_fn(timestamps)


def _fetch_recent_timestamps_by_channel(
    session: Session, channel_names: list[str]
) -> dict[str, list[int]]:
    from app.services.channels import _fetch_recent_timestamps_by_channel as fetch_fn

    return fetch_fn(session, channel_names)


def recompute_next_regular_sync_at_on_interval_change(
    channel: Channel,
    *,
    previous_interval_minutes: int,
    now_ms: int | None = None,
    regular_sync_enabled: bool,
    auto_sync_interval_minutes: int,
) -> None:
    if auto_sync_interval_minutes == previous_interval_minutes:
        return
    if not regular_sync_enabled:
        return
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    channel.next_regular_sync_at = compute_next_regular_sync_at_from_last_updated(
        channel.last_updated,
        auto_sync_interval_minutes,
        now_ms,
    )


def recompute_next_dynamic_sync_at_on_expected_posts_change(
    session: Session,
    channel: Channel,
    *,
    previous_expected_posts: int,
    now_ms: int | None = None,
    dynamic_sync_enabled: bool,
    dynamic_sync_expected_posts: int,
) -> None:
    if dynamic_sync_expected_posts == previous_expected_posts:
        return
    if not dynamic_sync_enabled:
        return
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    recent_timestamps = _fetch_recent_timestamps_by_channel(
        session, [channel.name]
    ).get(channel.name, [])
    has_posts = bool(recent_timestamps)
    velocity = _velocity_from_timestamps(recent_timestamps)
    if not has_posts:
        channel.next_dynamic_sync_at = None
    elif velocity > 0:
        channel.next_dynamic_sync_at = compute_next_dynamic_sync_at_from_last_updated(
            channel.last_updated,
            dynamic_sync_expected_posts,
            velocity,
            now_ms,
        )


INHERITED_SNAKE_FIELDS = frozenset(
    {
        "regular_sync_enabled",
        "dynamic_sync_enabled",
        "auto_sync_interval_minutes",
        "dynamic_sync_expected_posts",
        "auto_follow_forwarded",
        "is_frozen",
        "is_unavailable_on_web_view",
    }
)

RESTRICTED_GROUP_NAME = "Restricted"
DEFAULT_GROUP_NAME = "default"


def channel_is_frozen(
    channel: Channel, groups_by_id: dict[str, ChannelSettingGroup]
) -> bool:
    group = groups_by_id.get(channel.setting_group_id)
    return bool(group and group.is_frozen)


def scope_key(user_id: uuid.UUID | None) -> str:
    return str(user_id) if user_id is not None else "global"


def default_group_id_for_user(user_id: uuid.UUID | None) -> str:
    return f"default-{scope_key(user_id)}"


def restricted_group_id_for_user(user_id: uuid.UUID | None) -> str:
    return f"restricted-{scope_key(user_id)}"


def reject_inherited_channel_fields(body: dict[str, Any]) -> None:
    normalized = normalize_body(body)
    blocked = sorted(
        to_camel(key)
        for key in normalized
        if key in INHERITED_SNAKE_FIELDS or to_snake(key) in INHERITED_SNAKE_FIELDS
    )
    if blocked:
        raise HTTPException(
            status_code=400,
            detail=(
                "Sync and operational settings are managed per setting group. "
                f"Cannot update inherited fields on a channel: {', '.join(blocked)}. "
                "Update the channel's setting group or reassign it via "
                "PATCH /data/channels/bulk-setting-group."
            ),
        )


def default_group_field_values(session: Session) -> dict[str, Any]:
    sync_defaults = load_sync_settings(session)
    return {
        "regular_sync_enabled": True,
        "dynamic_sync_enabled": bool(sync_defaults.get("dynamicSyncEnabledDefault", False)),
        "auto_sync_interval_minutes": max(
            1, int(sync_defaults.get("regularSyncIntervalMinutes") or 60)
        ),
        "dynamic_sync_expected_posts": max(
            1, int(sync_defaults.get("dynamicSyncExpectedPostsDefault") or 15)
        ),
        "auto_follow_forwarded": False,
        "is_frozen": False,
        "is_unavailable_on_web_view": False,
    }


def ensure_default_group(
    session: Session, *, user_id: uuid.UUID | None
) -> ChannelSettingGroup:
    group_id = default_group_id_for_user(user_id)
    existing = session.get(ChannelSettingGroup, group_id)
    if existing:
        return existing
    values = default_group_field_values(session)
    group = ChannelSettingGroup(
        id=group_id,
        user_id=user_id,
        name=DEFAULT_GROUP_NAME,
        is_default=True,
        **values,
    )
    session.add(group)
    session.flush()
    return group


def get_or_create_restricted_group(
    session: Session, *, user_id: uuid.UUID | None
) -> ChannelSettingGroup:
    group_id = restricted_group_id_for_user(user_id)
    existing = session.get(ChannelSettingGroup, group_id)
    if existing:
        return existing
    values = default_group_field_values(session)
    group = ChannelSettingGroup(
        id=group_id,
        user_id=user_id,
        name=RESTRICTED_GROUP_NAME,
        is_default=False,
        regular_sync_enabled=False,
        dynamic_sync_enabled=False,
        is_frozen=True,
        is_unavailable_on_web_view=True,
        auto_sync_interval_minutes=values["auto_sync_interval_minutes"],
        dynamic_sync_expected_posts=values["dynamic_sync_expected_posts"],
        auto_follow_forwarded=False,
    )
    session.add(group)
    session.flush()
    return group


def get_group_for_channel(session: Session, channel: Channel) -> ChannelSettingGroup:
    group = session.get(ChannelSettingGroup, channel.setting_group_id)
    if not group:
        raise HTTPException(
            status_code=500,
            detail=f"Setting group not found for channel {channel.id}",
        )
    return group


def load_groups_by_id(session: Session) -> dict[str, ChannelSettingGroup]:
    return {group.id: group for group in session.exec(select(ChannelSettingGroup)).all()}


def channel_counts_by_group(session: Session) -> dict[str, int]:
    rows = session.exec(
        select(Channel.setting_group_id, func.count())
        .group_by(Channel.setting_group_id)
    ).all()
    return {group_id: count for group_id, count in rows}


def setting_group_to_camel(
    group: ChannelSettingGroup,
    *,
    channel_count: int | None = None,
) -> dict[str, Any]:
    row = {
        "id": group.id,
        "name": group.name,
        "isDefault": group.is_default,
        "regularSyncEnabled": group.regular_sync_enabled,
        "dynamicSyncEnabled": group.dynamic_sync_enabled,
        "autoSyncIntervalMinutes": group.auto_sync_interval_minutes,
        "dynamicSyncExpectedPosts": group.dynamic_sync_expected_posts,
        "autoFollowForwarded": group.auto_follow_forwarded,
        "isFrozen": group.is_frozen,
        "isUnavailableOnWebView": group.is_unavailable_on_web_view,
        "createdAt": int(group.created_at.timestamp() * 1000),
        "updatedAt": int(group.updated_at.timestamp() * 1000),
    }
    if channel_count is not None:
        row["channelCount"] = channel_count
    return row


def effective_channel_fields(group: ChannelSettingGroup) -> dict[str, Any]:
    return {
        "settingGroupId": group.id,
        "settingGroupName": group.name,
        "regularSyncEnabled": group.regular_sync_enabled,
        "dynamicSyncEnabled": group.dynamic_sync_enabled,
        "autoSyncIntervalMinutes": group.auto_sync_interval_minutes,
        "dynamicSyncExpectedPosts": group.dynamic_sync_expected_posts,
        "autoFollowForwarded": group.auto_follow_forwarded,
        "isFrozen": group.is_frozen,
        "isUnavailableOnWebView": group.is_unavailable_on_web_view,
    }


def apply_group_fields(group: ChannelSettingGroup, body: dict[str, Any]) -> None:
    normalized = normalize_body(body)
    if "name" in normalized and group.is_default:
        normalized.pop("name", None)
    if "name" in normalized:
        name = str(normalized["name"]).strip()
        if not name:
            raise HTTPException(status_code=400, detail="Group name is required")
        group.name = name
    for key in INHERITED_SNAKE_FIELDS:
        if key not in normalized:
            continue
        value = normalized[key]
        if key in ("auto_sync_interval_minutes", "dynamic_sync_expected_posts"):
            value = max(1, int(value))
        setattr(group, key, value)
    group.updated_at = datetime.utcnow()


def recompute_channels_for_group(session: Session, group_id: str) -> int:
    channels = session.exec(
        select(Channel).where(Channel.setting_group_id == group_id)
    ).all()
    if not channels:
        return 0
    group = session.get(ChannelSettingGroup, group_id)
    if not group:
        return 0

    now_ms = int(time.time() * 1000)
    timestamps_by_channel = _fetch_recent_timestamps_by_channel(
        session, [channel.name for channel in channels]
    )
    for channel in channels:
        previous_interval = group.auto_sync_interval_minutes
        previous_expected_posts = group.dynamic_sync_expected_posts
        if not group.regular_sync_enabled:
            channel.next_regular_sync_at = None
        else:
            recompute_next_regular_sync_at_on_interval_change(
                channel,
                previous_interval_minutes=previous_interval,
                now_ms=now_ms,
                regular_sync_enabled=group.regular_sync_enabled,
                auto_sync_interval_minutes=group.auto_sync_interval_minutes,
            )
        if not group.dynamic_sync_enabled:
            channel.next_dynamic_sync_at = None
        else:
            recompute_next_dynamic_sync_at_on_expected_posts_change(
                session,
                channel,
                previous_expected_posts=previous_expected_posts,
                now_ms=now_ms,
                dynamic_sync_enabled=group.dynamic_sync_enabled,
                dynamic_sync_expected_posts=group.dynamic_sync_expected_posts,
            )
        channel.updated_at = datetime.utcnow()
        session.add(channel)
    return len(channels)


def list_setting_groups(
    session: Session, *, operator_id: uuid.UUID | None
) -> list[dict[str, Any]]:
    from app.services.operator import select_operator_channels

    operator_channels = select_operator_channels(session, operator_id=operator_id)
    group_ids = {channel.setting_group_id for channel in operator_channels}
    if not group_ids:
        return []

    groups = session.exec(
        select(ChannelSettingGroup).where(col(ChannelSettingGroup.id).in_(group_ids))
    ).all()
    counts = channel_counts_by_group(session)
    groups.sort(key=lambda group: (not group.is_default, group.name.lower()))
    return [
        setting_group_to_camel(group, channel_count=counts.get(group.id, 0))
        for group in groups
    ]


def create_setting_group(
    session: Session,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID | None,
) -> dict[str, Any]:
    normalized = normalize_body(body)
    name = str(normalized.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    if name.lower() == DEFAULT_GROUP_NAME:
        raise HTTPException(
            status_code=400,
            detail="Reserved group name; use the built-in default group",
        )

    group_id = str(uuid.uuid4())
    values = default_group_field_values(session)
    group = ChannelSettingGroup(
        id=group_id,
        user_id=user_id,
        name=name,
        is_default=False,
        **values,
    )
    apply_group_fields(group, normalized)
    session.add(group)
    session.commit()
    session.refresh(group)
    return setting_group_to_camel(group, channel_count=0)


def update_setting_group(
    session: Session,
    group_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    group = session.get(ChannelSettingGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Setting group not found")

    apply_group_fields(group, body)
    session.add(group)
    session.commit()
    recompute_channels_for_group(session, group_id)
    session.commit()
    counts = channel_counts_by_group(session)
    session.refresh(group)
    return setting_group_to_camel(group, channel_count=counts.get(group.id, 0))


def delete_setting_group(session: Session, group_id: str) -> dict[str, str]:
    group = session.get(ChannelSettingGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Setting group not found")
    if group.is_default:
        raise HTTPException(
            status_code=400,
            detail="The default setting group cannot be deleted",
        )

    channel_count = session.exec(
        select(func.count())
        .select_from(Channel)
        .where(Channel.setting_group_id == group_id)
    ).one()
    if channel_count:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot delete setting group with {channel_count} channel(s). "
                "Reassign those channels to another group via "
                "PATCH /data/channels/bulk-setting-group, then retry deletion."
            ),
        )

    session.delete(group)
    session.commit()
    return {"status": "deleted"}


def bulk_assign_setting_group(
    session: Session,
    *,
    channel_ids: list[str],
    setting_group_id: str,
    operator_id: uuid.UUID | None,
) -> dict[str, Any]:
    if not channel_ids:
        raise HTTPException(status_code=400, detail="channelIds is required")

    from app.services.operator import select_operator_channels

    group = session.get(ChannelSettingGroup, setting_group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Setting group not found")

    operator_channels = {
        channel.id: channel
        for channel in select_operator_channels(session, operator_id=operator_id)
    }
    missing = sorted(channel_id for channel_id in channel_ids if channel_id not in operator_channels)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Channels not found: {', '.join(missing)}",
        )

    now_ms = int(time.time() * 1000)
    for channel_id in channel_ids:
        channel = operator_channels[channel_id]
        channel.setting_group_id = setting_group_id
        if not group.regular_sync_enabled:
            channel.next_regular_sync_at = None
        else:
            recompute_next_regular_sync_at_on_interval_change(
                channel,
                previous_interval_minutes=group.auto_sync_interval_minutes,
                now_ms=now_ms,
                regular_sync_enabled=group.regular_sync_enabled,
                auto_sync_interval_minutes=group.auto_sync_interval_minutes,
            )
        if not group.dynamic_sync_enabled:
            channel.next_dynamic_sync_at = None
        else:
            recompute_next_dynamic_sync_at_on_expected_posts_change(
                session,
                channel,
                previous_expected_posts=group.dynamic_sync_expected_posts,
                now_ms=now_ms,
                dynamic_sync_enabled=group.dynamic_sync_enabled,
                dynamic_sync_expected_posts=group.dynamic_sync_expected_posts,
            )
        channel.updated_at = datetime.utcnow()
        session.add(channel)

    session.commit()
    return {"updated": len(channel_ids), "settingGroupId": setting_group_id}


def move_channel_to_restricted_group(
    session: Session,
    channel: Channel,
    *,
    user_id: uuid.UUID | None,
) -> ChannelSettingGroup:
    group = get_or_create_restricted_group(session, user_id=user_id or channel.user_id)
    channel.setting_group_id = group.id
    channel.updated_at = datetime.utcnow()
    session.add(channel)
    return group


def update_default_group_sync_settings(
    session: Session,
    *,
    user_id: uuid.UUID | None,
    regular_sync_enabled: bool | None,
    dynamic_sync_enabled: bool | None,
    auto_sync_interval_minutes: int | None,
    dynamic_sync_expected_posts: int | None,
) -> dict[str, int]:
    if all(
        value is None
        for value in (
            regular_sync_enabled,
            dynamic_sync_enabled,
            auto_sync_interval_minutes,
            dynamic_sync_expected_posts,
        )
    ):
        raise HTTPException(status_code=400, detail="No sync settings fields provided")

    group = ensure_default_group(session, user_id=user_id)
    patch: dict[str, Any] = {}
    if regular_sync_enabled is not None:
        patch["regular_sync_enabled"] = regular_sync_enabled
    if dynamic_sync_enabled is not None:
        patch["dynamic_sync_enabled"] = dynamic_sync_enabled
    if auto_sync_interval_minutes is not None:
        patch["auto_sync_interval_minutes"] = max(1, auto_sync_interval_minutes)
    if dynamic_sync_expected_posts is not None:
        patch["dynamic_sync_expected_posts"] = max(1, dynamic_sync_expected_posts)
    apply_group_fields(group, patch)
    session.add(group)
    session.commit()
    updated = recompute_channels_for_group(session, group.id)
    session.commit()
    return {"updated": updated}
