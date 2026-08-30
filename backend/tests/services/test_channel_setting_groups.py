from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Channel
from app.services.channel_setting_groups import (
    channel_is_frozen,
    consolidate_legacy_duplicate_reserved_groups,
    create_setting_group,
    effective_channel_fields,
    ensure_builtin_groups,
    ensure_default_group,
    ensure_reserved_groups,
    frozen_group_id_for_user,
    get_or_create_frozen_group,
    get_or_create_restricted_group,
    high_velocity_group_id_for_user,
    is_reserved_group_id,
    list_setting_groups,
    load_groups_by_id,
    restricted_group_id_for_user,
    slow_feed_group_id_for_user,
    update_setting_group,
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

        listed = list_setting_groups(session, user_id=user_id)
        names = {group["name"] for group in listed}
        assert names == {
            "default",
            "Slow feed",
            "High velocity",
            "Restricted",
            "Frozen",
        }
        for group in listed:
            assert group["channelCount"] == 0


def test_builtin_preset_groups_have_expected_sync_values() -> None:
    user_id = uuid.uuid4()
    with Session(engine) as session:
        _, slow_feed, high_velocity, _, _ = ensure_builtin_groups(
            session, user_id=user_id
        )
        restricted_group = get_or_create_restricted_group(session, user_id=user_id)
        frozen_group = get_or_create_frozen_group(session, user_id=user_id)
        session.commit()

        assert slow_feed.auto_sync_interval_minutes == 1440
        assert slow_feed.dynamic_sync_enabled is True
        assert slow_feed.dynamic_sync_expected_posts == 1
        assert high_velocity.auto_sync_interval_minutes == 60
        assert high_velocity.dynamic_sync_enabled is True
        assert high_velocity.dynamic_sync_expected_posts == 10
        assert is_reserved_group_id(slow_feed.id)
        assert is_reserved_group_id(high_velocity.id)
        assert slow_feed_group_id_for_user(user_id) == slow_feed.id
        assert high_velocity_group_id_for_user(user_id) == high_velocity.id

        assert restricted_group.include_in_sync_all is False
        assert restricted_group.include_in_bulk_sync is True
        assert frozen_group.include_in_bulk_sync is False
        assert frozen_group.allow_individual_sync is True


def test_create_setting_group_rejects_duplicate_names_case_insensitive() -> None:
    user_id = uuid.uuid4()
    with Session(engine) as session:
        create_setting_group(session, {"name": "My Group"}, user_id=user_id)
        with pytest.raises(HTTPException) as exc_info:
            create_setting_group(session, {"name": "my group"}, user_id=user_id)
        assert exc_info.value.status_code == 409


def test_update_setting_group_rejects_duplicate_names() -> None:
    user_id = uuid.uuid4()
    with Session(engine) as session:
        create_setting_group(session, {"name": "Alpha"}, user_id=user_id)
        second = create_setting_group(session, {"name": "Beta"}, user_id=user_id)
        with pytest.raises(HTTPException) as exc_info:
            update_setting_group(
                session,
                second["id"],
                {"name": "alpha"},
                user_id=user_id,
            )
        assert exc_info.value.status_code == 409


def test_create_setting_group_rejects_reserved_preset_names() -> None:
    user_id = uuid.uuid4()
    with Session(engine) as session:
        for reserved_name in ("Slow feed", "High velocity"):
            with pytest.raises(HTTPException) as exc_info:
                create_setting_group(session, {"name": reserved_name}, user_id=user_id)
            assert exc_info.value.status_code == 400


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
        create_setting_group(session, {"name": "Weekend digest"}, user_id=user_id)
        listed = list_setting_groups(session, user_id=user_id)
        names = {group["name"] for group in listed}
        assert "Weekend digest" in names
        custom_group = next(
            group for group in listed if group["name"] == "Weekend digest"
        )
        assert custom_group["channelCount"] == 0


def test_consolidate_legacy_duplicate_frozen_groups() -> None:
    user_id = uuid.uuid4()
    with Session(engine) as session:
        default_group = ensure_default_group(session, user_id=user_id)
        canonical_frozen = get_or_create_frozen_group(session, user_id=user_id)
        session.commit()

        merged = consolidate_legacy_duplicate_reserved_groups(session, user_id=user_id)
        session.commit()

        assert merged == 0
        listed = list_setting_groups(session, user_id=user_id)
        frozen_names = [group["name"] for group in listed if group["name"] == "Frozen"]
        assert frozen_names == ["Frozen"]
        assert default_group.id in {group["id"] for group in listed}
        assert canonical_frozen.id in {group["id"] for group in listed}


def test_list_setting_groups_avoids_loading_channel_rows() -> None:
    """Listing groups must not hydrate the caller's Channels to do it.

    The mocked target moved with ticket 21: this used to patch
    `services.operator.select_operator_channels`, and that module is gone —
    `followed_channels_for` is the function that now hydrates Channel rows, so
    it is the one that must not be reached from here.
    """
    user_id = uuid.uuid4()
    with Session(engine) as session:
        with patch(
            "app.services.follows.followed_channels_for"
        ) as mock_followed_channels_for:
            listed = list_setting_groups(session, user_id=user_id)
            mock_followed_channels_for.assert_not_called()
        assert len(listed) >= 5


def test_list_setting_groups_includes_orphan_group_from_distinct_query() -> None:
    from app.models_tg import ChannelSettingGroup

    user_id = uuid.uuid4()
    other_user_id = uuid.uuid4()
    with Session(engine) as session:
        ensure_default_group(session, user_id=user_id)
        orphan_group = ChannelSettingGroup(
            id=str(uuid.uuid4()),
            user_id=other_user_id,
            name="Other operator group",
            is_default=False,
            regular_sync_enabled=True,
            dynamic_sync_enabled=False,
            auto_sync_interval_minutes=60,
            dynamic_sync_expected_posts=15,
            auto_follow_forwarded=False,
            is_frozen=False,
            is_unavailable_on_web_view=False,
        )
        session.add(orphan_group)
        session.add(
            Channel(
                id="orphan-channel",
                name="orphan-channel",
                user_id=user_id,
                setting_group_id=orphan_group.id,
            )
        )
        session.commit()

        listed = list_setting_groups(session, user_id=user_id)
        listed_ids = {group["id"] for group in listed}
        assert orphan_group.id in listed_ids
