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


def test_bulk_sync_settings_apply_to_all(client: TestClient) -> None:
    headers = _auth(client)
    client.put(f"{PREFIX}/channels/bulk-all-a", json={"name": "bulk-all-a"}, headers=headers)
    client.put(f"{PREFIX}/channels/bulk-all-b", json={"name": "bulk-all-b"}, headers=headers)

    r = client.patch(
        f"{PREFIX}/channels/bulk-sync-settings",
        json={
            "channelIds": None,
            "regularSyncEnabled": False,
            "autoSyncIntervalMinutes": 120,
        },
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["updated"] >= 2

    listed = client.get(f"{PREFIX}/channels", headers=headers).json()
    rows = [row for row in listed if row["id"] in {"bulk-all-a", "bulk-all-b"}]
    assert len(rows) == 2
    for row in rows:
        assert row["regularSyncEnabled"] is False
        assert row["autoSyncIntervalMinutes"] == 120


def test_bulk_sync_settings_apply_to_selected(client: TestClient) -> None:
    headers = _auth(client)
    client.put(f"{PREFIX}/channels/bulk-sel-a", json={"name": "bulk-sel-a"}, headers=headers)
    client.put(f"{PREFIX}/channels/bulk-sel-b", json={"name": "bulk-sel-b"}, headers=headers)

    r = client.patch(
        f"{PREFIX}/channels/bulk-sync-settings",
        json={
            "channelIds": ["bulk-sel-a"],
            "dynamicSyncEnabled": True,
            "dynamicSyncExpectedPosts": 25,
        },
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["updated"] == 1

    listed = client.get(f"{PREFIX}/channels", headers=headers).json()
    target = next(row for row in listed if row["id"] == "bulk-sel-a")
    untouched = next(row for row in listed if row["id"] == "bulk-sel-b")
    assert target["dynamicSyncEnabled"] is True
    assert target["dynamicSyncExpectedPosts"] == 25
    assert untouched["dynamicSyncEnabled"] is False


def test_bulk_sync_settings_partial_patch(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/channels/bulk-partial",
        json={"name": "bulk-partial", "autoSyncIntervalMinutes": 30},
        headers=headers,
    )

    r = client.patch(
        f"{PREFIX}/channels/bulk-sync-settings",
        json={
            "channelIds": ["bulk-partial"],
            "regularSyncEnabled": True,
        },
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["updated"] == 1

    listed = client.get(f"{PREFIX}/channels", headers=headers).json()
    row = next(item for item in listed if item["id"] == "bulk-partial")
    assert row["regularSyncEnabled"] is True
    assert row["autoSyncIntervalMinutes"] == 30
