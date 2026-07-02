from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.core.config import settings
from app.services.channels import _velocity_from_timestamps
from app.services.sync_schedule import (
    compute_next_dynamic_sync_at_from_last_updated,
    compute_next_regular_sync_at_from_last_updated,
)

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


def test_bulk_sync_settings_interval_updates_next_regular_sync_at(
    client: TestClient,
) -> None:
    headers = _auth(client)
    last_updated = int(time.time() * 1000) - 600_000
    old_deadline = last_updated + 60 * 60_000
    channel_ids = ("bulk-int-a", "bulk-int-b")

    for channel_id in channel_ids:
        client.put(
            f"{PREFIX}/channels/{channel_id}",
            json={
                "name": channel_id,
                "autoSyncIntervalMinutes": 60,
                "lastUpdated": last_updated,
                "nextRegularSyncAt": old_deadline,
            },
            headers=headers,
        )

    r = client.patch(
        f"{PREFIX}/channels/bulk-sync-settings",
        json={"channelIds": None, "autoSyncIntervalMinutes": 90},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["updated"] >= 2

    listed = client.get(f"{PREFIX}/channels", headers=headers).json()
    expected = compute_next_regular_sync_at_from_last_updated(
        last_updated, 90, int(time.time() * 1000)
    )
    for channel_id in channel_ids:
        row = next(item for item in listed if item["id"] == channel_id)
        assert row["autoSyncIntervalMinutes"] == 90
        assert row["nextRegularSyncAt"] == expected


def test_bulk_sync_settings_expected_posts_updates_next_dynamic_sync_at(
    client: TestClient,
) -> None:
    headers = _auth(client)
    last_updated = int(time.time() * 1000) - 600_000
    old_deadline = last_updated + 2 * 3_600_000
    now_ms = int(time.time() * 1000)
    post_timestamps = [now_ms - 3_600_000, now_ms - 1_800_000]
    channel_ids = ("bulk-dyn-a", "bulk-dyn-b")

    for channel_id in channel_ids:
        client.put(
            f"{PREFIX}/channels/{channel_id}",
            json={
                "name": channel_id,
                "dynamicSyncEnabled": True,
                "dynamicSyncExpectedPosts": 15,
                "lastUpdated": last_updated,
                "nextDynamicSyncAt": old_deadline,
            },
            headers=headers,
        )
        client.post(
            f"{PREFIX}/posts/bulk",
            json=[
                {
                    "id": 1,
                    "channelName": channel_id,
                    "text": "a",
                    "timestamp": post_timestamps[0],
                },
                {
                    "id": 2,
                    "channelName": channel_id,
                    "text": "b",
                    "timestamp": post_timestamps[1],
                },
            ],
            headers=headers,
        )

    r = client.patch(
        f"{PREFIX}/channels/bulk-sync-settings",
        json={"channelIds": None, "dynamicSyncExpectedPosts": 40},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["updated"] >= 2

    listed = client.get(f"{PREFIX}/channels", headers=headers).json()
    velocity = _velocity_from_timestamps(post_timestamps)
    assert velocity > 0
    expected = compute_next_dynamic_sync_at_from_last_updated(
        last_updated,
        40,
        velocity,
        now_ms,
    )
    for channel_id in channel_ids:
        row = next(item for item in listed if item["id"] == channel_id)
        assert row["dynamicSyncExpectedPosts"] == 40
        assert row["nextDynamicSyncAt"] == expected
