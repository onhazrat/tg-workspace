"""Tests for GET /data/stats and DELETE /data/logs."""

from __future__ import annotations

import time

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


def test_db_stats_returns_counts(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/channels/stats-ch",
        json={"name": "stats-ch"},
        headers=headers,
    )
    r = client.get(f"{PREFIX}/stats", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert "postCount" in data
    assert "channelCount" in data
    assert data["channelCount"] >= 1
    client.delete(f"{PREFIX}/channels/stats-ch", headers=headers)


def test_table_sizes_reports_every_export_section(client: TestClient) -> None:
    headers = _auth(client)
    client.post(
        f"{PREFIX}/sync-logs",
        json=[
            {
                "id": "table-size-log",
                "channelName": "ch",
                "status": "success",
                "timestamp": int(time.time() * 1000),
                "fullResponse": {"posts": [{"id": 1}] * 50},
            }
        ],
        headers=headers,
    )

    r = client.get(f"{PREFIX}/table-sizes", headers=headers)
    assert r.status_code == 200
    rows = {row["name"]: row for row in r.json()}

    assert set(rows) == {
        "setting_groups",
        "channels",
        "posts",
        "summaries",
        "bot_credentials",
        "chat_destinations",
        "publish_logs",
        "sync_logs",
        "llm_logs",
        "embedding_logs",
        "network_logs",
        "embeddings",
        "translations",
    }
    for row in rows.values():
        assert row["count"] >= 0
        assert row["size"] >= 0

    sync_logs = rows["sync_logs"]
    assert sync_logs["count"] >= 1
    # A table's physical footprint is never smaller than what a naive
    # in-app row-count-only view would suggest is "nothing" - this is the
    # bug being fixed, so pin down that size tracks real disk usage.
    assert sync_logs["size"] > 0


def test_clear_table_deletes_all_rows(client: TestClient) -> None:
    headers = _auth(client)
    client.post(
        f"{PREFIX}/sync-logs",
        json=[
            {
                "id": "clear-table-log",
                "channelName": "ch",
                "status": "success",
                "timestamp": int(time.time() * 1000),
            }
        ],
        headers=headers,
    )
    before = next(
        row
        for row in client.get(f"{PREFIX}/table-sizes", headers=headers).json()
        if row["name"] == "sync_logs"
    )
    assert before["count"] >= 1

    r = client.delete(f"{PREFIX}/tables/sync_logs", headers=headers)
    assert r.status_code == 200
    assert r.json()["deleted"] >= 1

    after = next(
        row
        for row in client.get(f"{PREFIX}/table-sizes", headers=headers).json()
        if row["name"] == "sync_logs"
    )
    assert after["count"] == 0


def test_clear_posts_also_clears_dependent_rows(client: TestClient) -> None:
    """Stale post_sync_state would make a later sync skip re-fetching."""
    headers = _auth(client)
    now_ms = int(time.time() * 1000)
    client.put(
        f"{PREFIX}/channels/cascade-ch",
        json={"name": "cascade-ch"},
        headers=headers,
    )
    client.post(
        f"{PREFIX}/posts/bulk",
        json=[
            {
                "id": 1,
                "channelName": "cascade-ch",
                "text": "hi",
                "date": "2024-01-01",
                "timestamp": now_ms,
            }
        ],
        headers=headers,
    )
    client.post(
        f"{PREFIX}/translations",
        json=[
            {
                "id": "cascade-ch_1_fa",
                "channelName": "cascade-ch",
                "postId": 1,
                "language": "fa",
                "translatedText": "سلام",
                "timestamp": now_ms,
            }
        ],
        headers=headers,
    )

    assert client.delete(f"{PREFIX}/tables/posts", headers=headers).status_code == 200

    sizes = {
        row["name"]: row
        for row in client.get(f"{PREFIX}/table-sizes", headers=headers).json()
    }
    assert sizes["posts"]["count"] == 0
    assert sizes["translations"]["count"] == 0, "orphaned translations left behind"

    client.delete(f"{PREFIX}/channels/cascade-ch", headers=headers)


def test_clear_table_rejects_unknown_name(client: TestClient) -> None:
    headers = _auth(client)
    r = client.delete(f"{PREFIX}/tables/not_a_real_table", headers=headers)
    assert r.status_code == 400


def test_settings_round_trip(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/settings/sync",
        json={"regularSyncIntervalMinutes": 45, "dynamicSyncEnabledDefault": True},
        headers=headers,
    )
    r = client.get(f"{PREFIX}/settings/sync", headers=headers)
    assert r.status_code == 200
    value = r.json()["value"]
    assert value["regularSyncIntervalMinutes"] == 45
    assert value["dynamicSyncEnabledDefault"] is True


def test_delete_log_by_id_and_clear(client: TestClient) -> None:
    headers = _auth(client)
    log_id = "test-pub-log-1"
    client.post(
        f"{PREFIX}/publish-logs",
        json=[
            {
                "id": log_id,
                "summaryId": "s1",
                "botId": "b1",
                "botName": "Bot",
                "chatId": "c1",
                "chatName": "Chat",
                "status": "success",
                "timestamp": int(time.time() * 1000),
            }
        ],
        headers=headers,
    )

    r = client.delete(
        f"{PREFIX}/logs",
        params={"type": "publish", "logId": log_id},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["deleted"] == 1

    client.post(
        f"{PREFIX}/publish-logs",
        json=[
            {
                "id": "test-pub-log-2",
                "summaryId": "s1",
                "botId": "b1",
                "botName": "Bot",
                "chatId": "c1",
                "chatName": "Chat",
                "status": "success",
                "timestamp": int(time.time() * 1000),
            }
        ],
        headers=headers,
    )
    r2 = client.delete(
        f"{PREFIX}/logs",
        params={"type": "publish", "clearAll": True},
        headers=headers,
    )
    assert r2.status_code == 200
    assert r2.json()["deleted"] >= 1


def test_delete_old_logs(client: TestClient) -> None:
    headers = _auth(client)
    old_ts = int(time.time() * 1000) - 40 * 24 * 60 * 60 * 1000
    client.post(
        f"{PREFIX}/sync-logs",
        json=[
            {
                "id": "old-sync-log",
                "channelName": "ch",
                "status": "success",
                "timestamp": old_ts,
            }
        ],
        headers=headers,
    )
    r = client.delete(
        f"{PREFIX}/logs",
        params={"olderThanDays": 30},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["total"] >= 1


def test_list_channels_include_stats(client: TestClient) -> None:
    headers = _auth(client)
    now_ms = int(time.time() * 1000)
    client.put(
        f"{PREFIX}/channels/stats-list-ch",
        json={"name": "stats-list-ch"},
        headers=headers,
    )
    posts = [
        {
            "id": 1,
            "channelName": "stats-list-ch",
            "text": "first",
            "date": "2024-01-01",
            "timestamp": now_ms - 3_600_000,
        },
        {
            "id": 2,
            "channelName": "stats-list-ch",
            "text": "second",
            "date": "2024-01-02",
            "timestamp": now_ms - 1_800_000,
        },
    ]
    client.post(f"{PREFIX}/posts/bulk", json=posts, headers=headers)

    r = client.get(
        f"{PREFIX}/channels",
        params={"includeStats": True},
        headers=headers,
    )
    assert r.status_code == 200
    row = next(c for c in r.json() if c["name"] == "stats-list-ch")
    stats = row["stats"]
    assert stats["count"] == 2
    assert stats["minId"] == 1
    assert stats["maxId"] == 2
    assert stats["velocity"] > 0

    client.delete(f"{PREFIX}/channels/stats-list-ch", headers=headers)
