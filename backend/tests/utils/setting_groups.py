"""Test helpers for channel setting groups."""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session, select

from app.models_tg import Channel, ChannelSettingGroup
from app.services.channel_setting_groups import (
    ensure_default_group,
    get_or_create_restricted_group,
)
from app.services.follows import ensure_follow_for_channel, get_operator_user_id
from tests.utils.tenancy import ANY_READER


def freeze_channels_except(session: Session, keep_ids: set[str]) -> None:
    # `ensure_default_group` requires a real owner since ticket 21, and the
    # bootstrap lookup answers None on a database whose superuser has not been
    # created yet. `ANY_READER` is a real seeded account, so it is a truthful
    # fallback rather than a placeholder the foreign key would reject.
    operator_id = get_operator_user_id(session) or ANY_READER
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
    """Insert a channel with a valid default setting group for service tests.

    An omitted `user_id` means `ANY_READER`, not "nobody". Ticket 21 made
    `tg_channel_setting_groups.user_id` `NOT NULL` with a foreign key, so a
    channel seeded with no owner now fails at the setting group before it ever
    reaches the Channel row — and a fabricated uuid fails at the key. The
    any-reader account is real, which makes it the one honest default.
    """
    if user_id is None:
        user_id = ANY_READER
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
    # See `add_test_channel`: an absent owner means the any-reader account.
    if user_id is None:
        user_id = ANY_READER
    default_group = ensure_default_group(session, user_id=user_id)
    if group_fields:
        for key, value in group_fields.items():
            setattr(default_group, key, value)
        session.add(default_group)

    channel = session.get(Channel, channel_id)
    payload: dict[str, Any] = {
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
    # The follow every production creation path writes (ticket 04's guard), so
    # a channel built by a test is not born in the one state ticket 05 made
    # meaningful: zero followers, which retention now collects. Without this a
    # fixture channel would vanish mid-test the moment a retention run happened
    # to touch it.
    session.flush()
    ensure_follow_for_channel(session, channel, user_id=user_id)
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
