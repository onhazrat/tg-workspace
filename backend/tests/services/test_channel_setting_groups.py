from __future__ import annotations

import uuid

from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Channel, ChannelSettingGroup
from app.services.channel_setting_groups import (
    channel_is_frozen,
    consolidate_legacy_duplicate_reserved_groups,
    create_setting_group,
    effective_channel_fields,
    ensure_default_group,
    ensure_reserved_groups,
    frozen_group_id_for_user,
    get_or_create_frozen_group,
    get_or_create_restricted_group,
    is_reserved_group_id,
    list_setting_groups,
    load_groups_by_id,
    restricted_group_id_for_user,
)


def test_effective_settings_and_frozen_group() -> None:
    user_id = uuid.uuid4()
    with Session(engine) as session:
        default_group = ensure_default_group(session, user_id=user_id)
        restricted_group = get_or_create_restricted_group(session, user_id=user_id)
        session.commit()

        channel = Channel(
            id="eff-test",
            name="eff-test",
            user_id=user_id,
            setting_group_id=default_group.id,
        )
        session.add(channel)
        session.commit()

        groups_by_id = load_groups_by_id(session)
        effective = effective_channel_fields(groups_by_id[channel.setting_group_id])
        assert effective["regularSyncEnabled"] is True
        assert effective["isFrozen"] is False
        assert channel_is_frozen(channel, groups_by_id) is False

        channel.setting_group_id = restricted_group.id
        session.add(channel)
        session.commit()
        groups_by_id = load_groups_by_id(session)
        assert channel_is_frozen(channel, groups_by_id) is True
        effective = effective_channel_fields(groups_by_id[channel.setting_group_id])
        assert effective["isFrozen"] is True
        assert effective["isUnavailableOnWebView"] is True


def test_ensure_reserved_groups_and_list_empty() -> None:
    user_id = uuid.uuid4()
    with Session(engine) as session:
        default_group, restricted_group, frozen_group = ensure_reserved_groups(
            session, user_id=user_id
        )
        session.commit()

        assert default_group.is_default is True
        assert restricted_group.name == "Restricted"
        assert frozen_group.name == "Frozen"
        assert frozen_group.is_frozen is True
        assert frozen_group.is_unavailable_on_web_view is False
        assert restricted_group.is_unavailable_on_web_view is True
        assert is_reserved_group_id(default_group.id)
        assert is_reserved_group_id(restricted_group.id)
        assert is_reserved_group_id(frozen_group.id)
        assert frozen_group_id_for_user(user_id) == frozen_group.id
        assert restricted_group_id_for_user(user_id) == restricted_group.id

        listed = list_setting_groups(session, operator_id=user_id)
        names = {group["name"] for group in listed}
        assert names == {"default", "Restricted", "Frozen"}
        for group in listed:
            assert group["channelCount"] == 0


def test_get_or_create_frozen_group_is_idempotent() -> None:
    user_id = uuid.uuid4()
    with Session(engine) as session:
        first = get_or_create_frozen_group(session, user_id=user_id)
        session.commit()
        second = get_or_create_frozen_group(session, user_id=user_id)
        assert first.id == second.id


def test_list_setting_groups_includes_empty_custom_groups() -> None:
    user_id = uuid.uuid4()
    with Session(engine) as session:
        create_setting_group(session, {"name": "Slow feed"}, user_id=user_id)
        listed = list_setting_groups(session, operator_id=user_id)
        names = {group["name"] for group in listed}
        assert "Slow feed" in names
        slow_feed = next(group for group in listed if group["name"] == "Slow feed")
        assert slow_feed["channelCount"] == 0


def test_consolidate_legacy_duplicate_frozen_groups() -> None:
    user_id = uuid.uuid4()
    with Session(engine) as session:
        default_group = ensure_default_group(session, user_id=user_id)
        canonical_frozen = get_or_create_frozen_group(session, user_id=user_id)
        legacy_frozen_id = str(uuid.uuid4())
        legacy_frozen = ChannelSettingGroup(
            id=legacy_frozen_id,
            user_id=user_id,
            name="Frozen",
            is_default=False,
            regular_sync_enabled=False,
            dynamic_sync_enabled=False,
            is_frozen=True,
        )
        session.add(legacy_frozen)
        channel = Channel(
            id="legacy-frozen-test",
            name="legacy-frozen-test",
            user_id=user_id,
            setting_group_id=legacy_frozen_id,
        )
        session.add(channel)
        session.commit()

        merged = consolidate_legacy_duplicate_reserved_groups(
            session, user_id=user_id
        )
        session.commit()

        assert merged == 1
        session.refresh(channel)
        assert channel.setting_group_id == canonical_frozen.id
        assert session.get(ChannelSettingGroup, legacy_frozen_id) is None

        listed = list_setting_groups(session, operator_id=user_id)
        frozen_names = [group["name"] for group in listed if group["name"] == "Frozen"]
        assert frozen_names == ["Frozen"]
        assert default_group.id in {group["id"] for group in listed}
