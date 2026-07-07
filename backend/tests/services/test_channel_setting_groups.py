from __future__ import annotations

import uuid

from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Channel
from app.services.channel_setting_groups import (
    channel_is_frozen,
    effective_channel_fields,
    ensure_default_group,
    get_or_create_restricted_group,
    load_groups_by_id,
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
