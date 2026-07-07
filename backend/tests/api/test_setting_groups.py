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
    assert "Slow feed" in names
    assert "High velocity" in names
    assert "Restricted" in names
    assert "Frozen" in names
    restricted = next(group for group in groups if group["name"] == "Restricted")
    frozen = next(group for group in groups if group["name"] == "Frozen")
    slow_feed = next(group for group in groups if group["name"] == "Slow feed")
    high_velocity = next(group for group in groups if group["name"] == "High velocity")
    assert restricted["channelCount"] == 0
    assert frozen["channelCount"] == 0
    assert slow_feed["channelCount"] == 0
    assert high_velocity["channelCount"] == 0
    assert slow_feed["isReserved"] is True
    assert high_velocity["autoSyncIntervalMinutes"] == 60
    assert slow_feed["autoSyncIntervalMinutes"] == 1440


def test_setting_groups_list_includes_empty_custom_group(client: TestClient) -> None:
    headers = _auth(client)
    created = client.post(
        f"{PREFIX}/setting-groups",
        json={"name": "Weekend digest"},
        headers=headers,
    )
    assert created.status_code == 200
    custom_group = created.json()

    listed = client.get(f"{PREFIX}/setting-groups", headers=headers)
    assert listed.status_code == 200
    groups = listed.json()
    ids = {group["id"] for group in groups}
    assert custom_group["id"] in ids
    weekend_digest = next(
        group for group in groups if group["id"] == custom_group["id"]
    )
    assert weekend_digest["name"] == "Weekend digest"
    assert weekend_digest["channelCount"] == 0


def test_setting_groups_deduplicate_legacy_frozen_group(client: TestClient) -> None:
    headers = _auth(client)
    listed = client.get(f"{PREFIX}/setting-groups", headers=headers).json()
    frozen_groups = [group for group in listed if group["name"] == "Frozen"]
    assert len(frozen_groups) == 1
    assert frozen_groups[0]["id"].startswith("frozen-")


def test_setting_groups_block_reserved_names_and_deletion(
    client: TestClient,
) -> None:
    headers = _auth(client)
    listed = client.get(f"{PREFIX}/setting-groups", headers=headers).json()
    default_group = next(group for group in listed if group["isDefault"])
    restricted_group = next(group for group in listed if group["name"] == "Restricted")
    frozen_group = next(group for group in listed if group["name"] == "Frozen")
    slow_feed = next(group for group in listed if group["name"] == "Slow feed")
    high_velocity = next(
        group for group in listed if group["name"] == "High velocity"
    )

    for reserved_name in ("Frozen", "Restricted", "default", "Slow feed", "High velocity"):
        created = client.post(
            f"{PREFIX}/setting-groups",
            json={"name": reserved_name},
            headers=headers,
        )
        assert created.status_code == 400

    duplicate = client.post(
        f"{PREFIX}/setting-groups",
        json={"name": "slow feed"},
        headers=headers,
    )
    assert duplicate.status_code == 400

    created = client.post(
        f"{PREFIX}/setting-groups",
        json={"name": "Unique Group"},
        headers=headers,
    )
    assert created.status_code == 200
    second = client.post(
        f"{PREFIX}/setting-groups",
        json={"name": "Another Group"},
        headers=headers,
    )
    assert second.status_code == 200
    duplicate_update = client.put(
        f"{PREFIX}/setting-groups/{second.json()['id']}",
        json={"name": "UNIQUE GROUP"},
        headers=headers,
    )
    assert duplicate_update.status_code == 409

    for group in (restricted_group, frozen_group, slow_feed, high_velocity):
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
