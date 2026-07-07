from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings

PREFIX = f"{settings.API_V1_STR}/data"


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_setting_groups_crud_and_guards(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/channels/sg-test-a",
        json={"name": "sg-test-a"},
        headers=headers,
    )
    client.put(
        f"{PREFIX}/channels/sg-test-b",
        json={"name": "sg-test-b"},
        headers=headers,
    )

    listed = client.get(f"{PREFIX}/setting-groups", headers=headers)
    assert listed.status_code == 200
    groups = listed.json()
    default_group = next(group for group in groups if group["isDefault"])
    assert default_group["name"] == "default"

    created = client.post(
        f"{PREFIX}/setting-groups",
        json={"name": "High Activity", "dynamicSyncEnabled": True},
        headers=headers,
    )
    assert created.status_code == 200
    custom_group = created.json()
    assert custom_group["dynamicSyncEnabled"] is True

    updated = client.put(
        f"{PREFIX}/setting-groups/{custom_group['id']}",
        json={"autoSyncIntervalMinutes": 45},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["autoSyncIntervalMinutes"] == 45

    assign = client.patch(
        f"{PREFIX}/channels/bulk-setting-group",
        json={"channelIds": ["sg-test-a"], "settingGroupId": custom_group["id"]},
        headers=headers,
    )
    assert assign.status_code == 200
    assert assign.json()["updated"] == 1

    channels = client.get(f"{PREFIX}/channels", headers=headers).json()
    row = next(item for item in channels if item["id"] == "sg-test-a")
    assert row["settingGroupId"] == custom_group["id"]
    assert row["dynamicSyncEnabled"] is True

    delete_default = client.delete(
        f"{PREFIX}/setting-groups/{default_group['id']}",
        headers=headers,
    )
    assert delete_default.status_code == 400
    assert "default" in delete_default.json()["detail"].lower()

    delete_nonempty = client.delete(
        f"{PREFIX}/setting-groups/{default_group['id']}",
        headers=headers,
    )
    assert delete_nonempty.status_code == 400

    delete_custom_blocked = client.delete(
        f"{PREFIX}/setting-groups/{custom_group['id']}",
        headers=headers,
    )
    assert delete_custom_blocked.status_code == 400
    assert "reassign" in delete_custom_blocked.json()["detail"].lower()

    client.patch(
        f"{PREFIX}/channels/bulk-setting-group",
        json={"channelIds": ["sg-test-a"], "settingGroupId": default_group["id"]},
        headers=headers,
    )
    deleted = client.delete(
        f"{PREFIX}/setting-groups/{custom_group['id']}",
        headers=headers,
    )
    assert deleted.status_code == 200


def test_setting_groups_always_include_reserved_with_zero_count(
    client: TestClient,
) -> None:
    headers = _auth(client)
    listed = client.get(f"{PREFIX}/setting-groups", headers=headers)
    assert listed.status_code == 200
    groups = listed.json()
    names = {group["name"] for group in groups}
    assert "default" in names
    assert "Restricted" in names
    assert "Frozen" in names
    restricted = next(group for group in groups if group["name"] == "Restricted")
    frozen = next(group for group in groups if group["name"] == "Frozen")
    assert restricted["channelCount"] == 0
    assert frozen["channelCount"] == 0


def test_setting_groups_list_includes_empty_custom_group(client: TestClient) -> None:
    headers = _auth(client)
    created = client.post(
        f"{PREFIX}/setting-groups",
        json={"name": "Slow feed"},
        headers=headers,
    )
    assert created.status_code == 200
    custom_group = created.json()

    listed = client.get(f"{PREFIX}/setting-groups", headers=headers)
    assert listed.status_code == 200
    groups = listed.json()
    ids = {group["id"] for group in groups}
    assert custom_group["id"] in ids
    slow_feed = next(group for group in groups if group["id"] == custom_group["id"])
    assert slow_feed["name"] == "Slow feed"
    assert slow_feed["channelCount"] == 0


def test_setting_groups_deduplicate_legacy_frozen_group(client: TestClient) -> None:
    headers = _auth(client)
    listed = client.get(f"{PREFIX}/setting-groups", headers=headers).json()
    canonical_frozen = next(
        group for group in listed if group["id"].startswith("frozen-")
    )

    client.put(
        f"{PREFIX}/channels/sg-legacy-frozen",
        json={"name": "sg-legacy-frozen"},
        headers=headers,
    )

    from app.core.db import engine
    from sqlmodel import Session

    from app.models_tg import Channel, ChannelSettingGroup
    from app.services.operator import get_operator_user_id

    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        legacy_id = "legacy-frozen-uuid-test"
        session.add(
            ChannelSettingGroup(
                id=legacy_id,
                user_id=operator_id,
                name="Frozen",
                is_default=False,
                regular_sync_enabled=False,
                dynamic_sync_enabled=False,
                is_frozen=True,
            )
        )
        channel = session.get(Channel, "sg-legacy-frozen")
        assert channel is not None
        channel.setting_group_id = legacy_id
        session.add(channel)
        session.commit()

    relisted = client.get(f"{PREFIX}/setting-groups", headers=headers)
    assert relisted.status_code == 200
    groups = relisted.json()
    frozen_groups = [group for group in groups if group["name"] == "Frozen"]
    assert len(frozen_groups) == 1
    assert frozen_groups[0]["id"] == canonical_frozen["id"]

    channels = client.get(f"{PREFIX}/channels", headers=headers).json()
    row = next(item for item in channels if item["id"] == "sg-legacy-frozen")
    assert row["settingGroupId"] == canonical_frozen["id"]


def test_setting_groups_block_reserved_names_and_deletion(
    client: TestClient,
) -> None:
    headers = _auth(client)
    listed = client.get(f"{PREFIX}/setting-groups", headers=headers).json()
    default_group = next(group for group in listed if group["isDefault"])
    restricted_group = next(group for group in listed if group["name"] == "Restricted")
    frozen_group = next(group for group in listed if group["name"] == "Frozen")

    for reserved_name in ("Frozen", "Restricted", "default"):
        created = client.post(
            f"{PREFIX}/setting-groups",
            json={"name": reserved_name},
            headers=headers,
        )
        assert created.status_code == 400

    for group in (restricted_group, frozen_group):
        deleted = client.delete(
            f"{PREFIX}/setting-groups/{group['id']}",
            headers=headers,
        )
        assert deleted.status_code == 400
        assert "cannot be deleted" in deleted.json()["detail"].lower()

    delete_default = client.delete(
        f"{PREFIX}/setting-groups/{default_group['id']}",
        headers=headers,
    )
    assert delete_default.status_code == 400


def test_channel_put_rejects_inherited_fields(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/channels/sg-guard",
        json={"name": "sg-guard"},
        headers=headers,
    )
    response = client.put(
        f"{PREFIX}/channels/sg-guard",
        json={"regularSyncEnabled": False},
        headers=headers,
    )
    assert response.status_code == 400
    assert "setting group" in response.json()["detail"].lower()


def test_bulk_sync_settings_updates_default_group_only(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/channels/sg-bulk-a",
        json={"name": "sg-bulk-a"},
        headers=headers,
    )
    client.put(
        f"{PREFIX}/channels/sg-bulk-b",
        json={"name": "sg-bulk-b"},
        headers=headers,
    )

    selected = client.patch(
        f"{PREFIX}/channels/bulk-sync-settings",
        json={"channelIds": ["sg-bulk-a"], "regularSyncEnabled": False},
        headers=headers,
    )
    assert selected.status_code == 400

    all_channels = client.patch(
        f"{PREFIX}/channels/bulk-sync-settings",
        json={"channelIds": None, "regularSyncEnabled": False, "autoSyncIntervalMinutes": 120},
        headers=headers,
    )
    assert all_channels.status_code == 200
    assert all_channels.json()["updated"] >= 2

    listed = client.get(f"{PREFIX}/channels", headers=headers).json()
    for channel_id in ("sg-bulk-a", "sg-bulk-b"):
        row = next(item for item in listed if item["id"] == channel_id)
        assert row["regularSyncEnabled"] is False
        assert row["autoSyncIntervalMinutes"] == 120
