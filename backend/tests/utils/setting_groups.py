"""Test helpers for channel setting groups."""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session, select

from app.models_tg import Channel, ChannelFollow, ChannelSettingGroup
from app.services.channel_setting_groups import (
    ensure_default_group,
    get_or_create_restricted_group,
)
from app.services.follows import (
    FOLLOW_OWNED_FIELDS,
    get_operator_user_id,
    sync_follow_settings,
)
from tests.utils.tenancy import ANY_READER


def freeze_channels_except(session: Session, keep_ids: set[str]) -> None:
    # `ensure_default_group` requires a real owner since ticket 21, and the
    # bootstrap lookup answers None on a database whose superuser has not been
    # created yet. `ANY_READER` is a real seeded account, so it is a truthful
    # fallback rather than a placeholder the foreign key would reject.
    operator_id = get_operator_user_id(session) or ANY_READER
    default_group = ensure_default_group(session, user_id=operator_id)
    frozen_group = get_or_create_restricted_group(session, user_id=operator_id)
    # Every *follow*, not every Channel: ticket 22 moved the group off the
    # Channel, so freezing is now something an account does to its own list.
    # Walking follows rather than channels also means a deliberately unfollowed
    # channel stays unfollowed — several tests seed one to prove it is synced
    # for nobody, and re-grouping it here would have written a follow they
    # depend on not existing.
    for follow in session.exec(select(ChannelFollow)).all():
        follow.setting_group_id = (
            default_group.id if follow.channel_id in keep_ids else frozen_group.id
        )
        session.add(follow)
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

    An omitted `user_id` means **the operator**, falling back to `ANY_READER`
    on a database whose first superuser does not exist yet. Neither half is
    arbitrary.

    *Not "nobody"*: ticket 21 PR 3 made `tg_channel_setting_groups.user_id`
    `NOT NULL` with a foreign key, so a channel seeded with no owner fails at
    the setting group before it ever reaches the Channel row, and a fabricated
    uuid fails at the key.

    *The operator rather than `ANY_READER`*: PR 4 flips `TENANCY_ENFORCED`, and
    this helper writes the **Follow** as well as the Channel. The great majority
    of callers are API tests reading back through the test client as
    `FIRST_SUPERUSER`, so a follow owned by the any-reader account leaves them
    exactly as empty as no follow at all — passing for a new wrong reason rather
    than an old one. Twelve tests moved on this one line. Service tests that
    read as `ANY_READER` pass it explicitly, which is the readable half anyway:
    the owner a test seeds should be the account it then reads as, and where
    those differ the test is usually about that difference.
    """
    if user_id is None:
        user_id = get_operator_user_id(session) or ANY_READER
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

    # Ticket 22 split the payload: the Channel keeps the corpus fields, and the
    # group plus anything per-User goes on the follow. A helper that kept
    # writing them to the Channel would raise, and one that simply dropped them
    # would seed a channel with no resolvable group — which every scheduler test
    # reads as "skip this channel", passing for the wrong reason.
    supplied = dict(channel_fields or {})
    follow_values: dict[str, Any] = {
        key: supplied.pop(key) for key in list(supplied) if key in FOLLOW_OWNED_FIELDS
    }
    follow_values.setdefault("setting_group_id", default_group.id)

    channel = session.get(Channel, channel_id)
    payload: dict[str, Any] = {
        "id": channel_id,
        "name": name or channel_id,
        **supplied,
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
    sync_follow_settings(session, channel, user_id=user_id, values=follow_values)
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
