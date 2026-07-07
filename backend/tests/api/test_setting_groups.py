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
