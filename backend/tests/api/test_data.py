"""Tests for /api/v1/data CRUD, import/export, and date-range queries."""

import time

from fastapi.testclient import TestClient

from app.core.config import settings
from app.services.sync_schedule import compute_next_regular_sync_at_from_last_updated

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


def test_channels_crud_roundtrip(client: TestClient) -> None:
    headers = _auth(client)
    r = client.put(
        f"{PREFIX}/channels/ch-test",
        json={"name": "ch-test", "displayName": "Test Channel", "startId": 42},
        headers=headers,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "ch-test"
    assert data["displayName"] == "Test Channel"
    assert data["startId"] == 42
    assert data["autoFollowForwarded"] is False

    r_update = client.put(
        f"{PREFIX}/channels/ch-test",
        json={"name": "ch-test", "autoFollowForwarded": True},
        headers=headers,
    )
    assert r_update.status_code == 200
    assert r_update.json()["autoFollowForwarded"] is True

    r2 = client.get(f"{PREFIX}/channels", headers=headers)
    assert r2.status_code == 200
    names = [c["name"] for c in r2.json()]
    assert "ch-test" in names

    r3 = client.delete(f"{PREFIX}/channels/ch-test", headers=headers)
    assert r3.status_code == 200


def test_put_channel_interval_updates_next_regular_sync_at(
    client: TestClient,
) -> None:
    headers = _auth(client)
    last_updated = int(time.time() * 1000) - 900_000
    old_deadline = last_updated + 60 * 60_000
    channel_id = "ch-interval-deadline"
    try:
        r_create = client.put(
            f"{PREFIX}/channels/{channel_id}",
            json={
                "name": channel_id,
                "autoSyncIntervalMinutes": 60,
                "lastUpdated": last_updated,
                "nextRegularSyncAt": old_deadline,
            },
            headers=headers,
        )
        assert r_create.status_code == 200

        r_update = client.put(
            f"{PREFIX}/channels/{channel_id}",
            json={"name": channel_id, "autoSyncIntervalMinutes": 120},
            headers=headers,
        )
        assert r_update.status_code == 200
        data = r_update.json()
        assert data["autoSyncIntervalMinutes"] == 120
        assert data["nextRegularSyncAt"] is not None
        expected = compute_next_regular_sync_at_from_last_updated(
            last_updated, 120, int(time.time() * 1000)
        )
        assert data["nextRegularSyncAt"] == expected

        frozen_deadline = data["nextRegularSyncAt"]
        r_unchanged = client.put(
            f"{PREFIX}/channels/{channel_id}",
            json={
                "name": channel_id,
                "autoSyncIntervalMinutes": 120,
                "displayName": "Same interval",
            },
            headers=headers,
        )
        assert r_unchanged.status_code == 200
        assert r_unchanged.json()["nextRegularSyncAt"] == frozen_deadline
    finally:
        client.delete(f"{PREFIX}/channels/{channel_id}", headers=headers)


def test_posts_date_range_query(client: TestClient) -> None:
    headers = _auth(client)
    client.put(
        f"{PREFIX}/channels/range-ch",
        json={"name": "range-ch"},
        headers=headers,
    )
    posts = [
        {
            "id": 1,
            "channelName": "range-ch",
            "text": "old",
            "date": "2024-01-01",
            "timestamp": 1000,
        },
        {
            "id": 2,
            "channelName": "range-ch",
            "text": "mid",
            "date": "2024-01-02",
            "timestamp": 2000,
        },
        {
            "id": 3,
            "channelName": "range-ch",
            "text": "new",
            "date": "2024-01-03",
            "timestamp": 3000,
        },
    ]
    r = client.post(f"{PREFIX}/posts/bulk", json=posts, headers=headers)
    assert r.status_code == 200

    r2 = client.get(
        f"{PREFIX}/posts",
        params={"channelNames": "range-ch", "startDate": 1500, "endDate": 2500},
        headers=headers,
    )
    assert r2.status_code == 200
    result = r2.json()
    assert len(result) == 1
    assert result[0]["id"] == 2
    assert result[0]["channelName"] == "range-ch"

    client.delete(f"{PREFIX}/channels/range-ch", headers=headers)


def test_summaries_crud(client: TestClient) -> None:
    headers = _auth(client)
    body = {
        "text": "summary text",
        "channels": ["ch1"],
        "startDate": 1000,
        "endDate": 2000,
        "timestamp": 5000,
        "autoRegenerate": True,
    }
    r = client.put(f"{PREFIX}/summaries/sum-1", json=body, headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["startDate"] == 1000
    assert data["autoRegenerate"] is True

    r2 = client.get(f"{PREFIX}/summaries", headers=headers)
    assert any(s["id"] == "sum-1" for s in r2.json())

    r3 = client.delete(f"{PREFIX}/summaries/sum-1", headers=headers)
    assert r3.status_code == 200


def test_summaries_pending_prompt_extra(client: TestClient) -> None:
    headers = _auth(client)
    pending = {
        "text": "",
        "channels": ["ch1"],
        "startDate": 1000,
        "endDate": 2000,
        "timestamp": 5000,
        "status": "pending",
        "promptText": "Analyze these posts...",
        "postCount": 12,
        "language": "English",
    }
    r = client.put(f"{PREFIX}/summaries/pending-1", json=pending, headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "pending"
    assert data["promptText"] == "Analyze these posts..."

    complete = {
        **pending,
        "text": "Completed summary",
        "source": "pasted",
        "status": None,
    }
    r2 = client.put(f"{PREFIX}/summaries/pending-1", json=complete, headers=headers)
    assert r2.status_code == 200
    completed = r2.json()
    assert completed["text"] == "Completed summary"
    assert completed["source"] == "pasted"
    assert "status" not in completed

    client.delete(f"{PREFIX}/summaries/pending-1", headers=headers)


def test_bot_credentials_export_import(client: TestClient) -> None:
    headers = _auth(client)
    r = client.put(
        f"{PREFIX}/bot-credentials/bot-1",
        json={"name": "My Bot", "token": "123:ABC", "username": "mybot"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["hasToken"] is True
    assert "token" not in r.json()

    r2 = client.get(f"{PREFIX}/export", headers=headers)
    assert r2.status_code == 200
    exported = r2.json()
    bots = exported["data"]["bot_credentials"]
    assert len(bots) >= 1
    exported_bot = next(b for b in bots if b["id"] == "bot-1")
    assert "token" not in exported_bot
    assert exported_bot.get("hasToken") is True

    client.delete(f"{PREFIX}/bot-credentials/bot-1", headers=headers)


def test_import_export_roundtrip(client: TestClient) -> None:
    headers = _auth(client)
    payload = {
        "data": {
            "channels": [{"id": "imp-ch", "name": "imp-ch", "displayName": "Imported"}],
            "posts": [
                {
                    "id": 10,
                    "channelName": "imp-ch",
                    "text": "hello",
                    "date": "2024-06-01",
                    "timestamp": 9999,
                }
            ],
            "summaries": [
                {
                    "id": "imp-sum",
                    "text": "imported summary",
                    "channels": ["imp-ch"],
                    "startDate": 1,
                    "endDate": 2,
                    "timestamp": 3,
                    "language": "English",
                }
            ],
            "bot_credentials": [{"id": "imp-bot", "name": "Bot", "token": "tok"}],
            "chat_destinations": [{"id": "imp-dest", "name": "Dest", "chatId": "-100"}],
            "publish_logs": [
                {
                    "id": "pl-1",
                    "summaryId": "imp-sum",
                    "botId": "imp-bot",
                    "botName": "Bot",
                    "chatId": "-100",
                    "chatName": "Dest",
                    "status": "success",
                    "timestamp": 100,
                }
            ],
            "sync_logs": [
                {
                    "id": "sl-1",
                    "channelName": "imp-ch",
                    "status": "success",
                    "postsCount": 1,
                    "timestamp": 100,
                    "source": "test",
                }
            ],
        }
    }
    r = client.post(f"{PREFIX}/import", json=payload, headers=headers)
    assert r.status_code == 200
    counts = r.json()["imported"]
    assert counts["channels"] == 1
    assert counts["posts"] == 1
    assert counts["summaries"] == 1
    assert counts["bot_credentials"] == 1
    assert counts["chat_destinations"] == 1
    assert counts["publish_logs"] == 1
    assert counts["sync_logs"] == 1

    r2 = client.get(f"{PREFIX}/export", headers=headers)
    assert r2.status_code == 200
    data = r2.json()["data"]
    assert any(c["id"] == "imp-ch" for c in data["channels"])
    assert any(p["id"] == 10 for p in data["posts"])
    assert any(b["id"] == "imp-bot" for b in data["bot_credentials"])

    client.delete(f"{PREFIX}/channels/imp-ch", headers=headers)
    client.delete(f"{PREFIX}/summaries/imp-sum", headers=headers)
    client.delete(f"{PREFIX}/bot-credentials/imp-bot", headers=headers)
    client.delete(f"{PREFIX}/chat-destinations/imp-dest", headers=headers)


def test_data_requires_auth(client: TestClient) -> None:
    r = client.get(f"{PREFIX}/channels")
    assert r.status_code in (401, 403)


def test_network_logs_crud(client: TestClient) -> None:
    headers = _auth(client)
    # JS Date.now() ms values exceed PostgreSQL INTEGER; must persist as BIGINT.
    js_timestamp = 1_780_946_501_328
    body = [
        {
            "id": "nl-test-1",
            "url": "https://t.me/s/test",
            "method": "GET",
            "status": "success",
            "statusCode": 200,
            "duration": 1200,
            "timestamp": js_timestamp,
            "source": "ChannelGrid",
            "proxyUsed": "socks5h://127.0.0.1:9050",
            "attempts": 1,
            "telemetry": {
                "success": True,
                "attempts": [{"attempt": 1, "proxyUrl": "socks5h://127.0.0.1:9050"}],
            },
        }
    ]
    try:
        r = client.post(f"{PREFIX}/network-logs", json=body, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["upserted"] == 1

        r2 = client.get(f"{PREFIX}/network-logs", headers=headers)
        assert r2.status_code == 200
        logs = r2.json()
        assert any(log["id"] == "nl-test-1" for log in logs)
        saved = next(log for log in logs if log["id"] == "nl-test-1")
        assert saved["statusCode"] == 200
        assert saved["proxyUsed"] == "socks5h://127.0.0.1:9050"
        assert saved["source"] == "ChannelGrid"
        assert saved["timestamp"] == js_timestamp
    finally:
        from sqlmodel import Session, delete

        from app.core.db import engine
        from app.models_tg import NetworkLog

        with Session(engine) as session:
            session.exec(delete(NetworkLog).where(NetworkLog.id == "nl-test-1"))
            session.commit()


def test_channel_upsert_ms_timestamps(client: TestClient) -> None:
    headers = _auth(client)
    js_now = 1_780_946_501_328
    try:
        r = client.put(
            f"{PREFIX}/channels/ch-ms-ts",
            json={
                "name": "ch-ms-ts",
                "lastUpdated": js_now,
                "followedAt": js_now,
                "startTime": js_now,
            },
            headers=headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["lastUpdated"] == js_now
        assert data["followedAt"] == js_now
        assert data["startTime"] == js_now
    finally:
        client.delete(f"{PREFIX}/channels/ch-ms-ts", headers=headers)
