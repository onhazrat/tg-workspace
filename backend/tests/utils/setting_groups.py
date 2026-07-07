"""Test helpers for channel setting groups."""

from __future__ import annotations

import uuid

from sqlmodel import Session, select

from app.models_tg import Channel, ChannelSettingGroup
from app.services.channel_setting_groups import (
    ensure_default_group,
    get_or_create_restricted_group,
)
from app.services.operator import get_operator_user_id


def freeze_channels_except(session: Session, keep_ids: set[str]) -> None:
    operator_id = get_operator_user_id(session)
    default_group = ensure_default_group(session, user_id=operator_id)
    frozen_group = get_or_create_restricted_group(session, user_id=operator_id)
    for channel in session.exec(select(Channel)).all():
        if channel.id in keep_ids:
            channel.setting_group_id = default_group.id
        else:
            channel.setting_group_id = frozen_group.id
        session.add(channel)
    session.commit()


def add_test_channel(
    session: Session,
    channel_id: str,
    *,
    name: str | None = None,
    user_id: uuid.UUID | None = None,
    **channel_fields,
) -> Channel:
    """Insert a channel with a valid default setting group for service tests."""
    return upsert_sync_test_channel(
        session,
        channel_id=channel_id,
        user_id=user_id,
        name=name,
        channel_fields=channel_fields or None,
    )


def upsert_sync_test_channel(
    session: Session,
    *,
    channel_id: str,
    user_id: uuid.UUID | None,
    name: str | None = None,
    group_fields: dict | None = None,
    channel_fields: dict | None = None,
) -> Channel:
    default_group = ensure_default_group(session, user_id=user_id)
    if group_fields:
        for key, value in group_fields.items():
            setattr(default_group, key, value)
        session.add(default_group)

    channel = session.get(Channel, channel_id)
    payload = {
        "id": channel_id,
        "name": name or channel_id,
        "user_id": user_id,
        "setting_group_id": default_group.id,
        **(channel_fields or {}),
    }
    if channel:
        for key, value in payload.items():
            if key != "id":
                setattr(channel, key, value)
    else:
        channel = Channel(**payload)
    session.add(channel)
    session.commit()
    session.refresh(channel)
    return channel


def set_group_fields(
    session: Session, group_id: str, fields: dict
) -> ChannelSettingGroup:
    group = session.get(ChannelSettingGroup, group_id)
    if not group:
        raise ValueError(f"Group not found: {group_id}")
    for key, value in fields.items():
        setattr(group, key, value)
    session.add(group)
    session.commit()
    session.refresh(group)
    return group
