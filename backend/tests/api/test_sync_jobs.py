"""Integration tests for server-side sync job orchestration."""

from __future__ import annotations

import json
import time
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import SyncJob
from app.services.scraper_jobs import (
    clear_active_jobs_for_tests,
    clear_jobs_for_tests,
    get_job,
)

PREFIX = f"{settings.API_V1_STR}/jobs"
DATA = f"{settings.API_V1_STR}/data"


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


def _mock_page_response(
    channel_name: str,
    posts: list[dict],
    *,
    latest_id: int | None = None,
    next_before_id: int | None = None,
) -> dict:
    latest = latest_id or (max(p["id"] for p in posts) if posts else 0)
    return {
        "channelName": channel_name,
        "displayName": "Sync Test",
        "photoUrl": "https://example.com/photo.jpg",
        "bio": "bio",
        "subscribers": "1K",
        "posts": posts,
        "latestId": latest,
        "nextBeforeId": next_before_id,
        "telemetry": {
            "success": True,
            "totalDuration": 120,
            "attempts": [{"proxyUrl": "direct", "success": True}],
        },
    }


def test_start_sync_job_and_poll_status(client: TestClient) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)

    client.put(
        f"{DATA}/channels/sync-test-ch",
        json={"name": "sync-test-ch", "displayName": "Sync Test"},
        headers=headers,
    )

    posts = [
        {
            "id": 100,
            "text": "Hello world",
            "date": "2024-06-01T12:00:00+00:00",
            "timestamp": 1_716_724_800_000,
        },
        {
            "id": 101,
            "text": "Second post",
            "date": "2024-06-01T13:00:00+00:00",
            "timestamp": 1_716_728_400_000,
        },
    ]

    with patch(
        "app.services.sync_orchestrator.scrape_channel_page",
        new_callable=AsyncMock,
        return_value=_mock_page_response("sync-test-ch", posts, next_before_id=None),
    ):
        r = client.post(
            f"{PREFIX}/sync",
            json={"channelIds": ["sync-test-ch"], "source": "Test"},
            headers=headers,
        )
        assert r.status_code == 200
        job_id = r.json()["jobId"]
        assert job_id

        deadline = time.time() + 10
        final_status = None
        while time.time() < deadline:
            status_r = client.get(f"{PREFIX}/sync/{job_id}", headers=headers)
            assert status_r.status_code == 200
            data = status_r.json()
            assert data["jobId"] == job_id
            assert len(data["channels"]) == 1
            assert data["channels"][0]["channelName"] == "sync-test-ch"
            if data["status"] in ("completed", "failed", "cancelled"):
                final_status = data
                break
            time.sleep(0.1)

        assert final_status is not None
        assert final_status["status"] == "completed"
        assert final_status["channels"][0]["status"] == "success"
        assert final_status["channels"][0]["postsFetched"] == 2

    posts_r = client.get(
        f"{DATA}/posts",
        params={"channelNames": "sync-test-ch"},
        headers=headers,
    )
    assert posts_r.status_code == 200
    assert len(posts_r.json()) == 2
    first_post = posts_r.json()[0]
    assert first_post.get("retrievalPass") == "initial"
    assert first_post.get("retrievedAt")

    sync_meta = client.get(f"{DATA}/sync-meta", headers=headers)
    assert sync_meta.status_code == 200
    assert "posts" in sync_meta.json()

    logs_r = client.get(f"{DATA}/sync-logs", headers=headers)
    assert logs_r.status_code == 200
    matching = [
        log for log in logs_r.json() if log.get("channelName") == "sync-test-ch"
    ]
    assert any(log["status"] == "success" for log in matching)

    client.delete(f"{DATA}/channels/sync-test-ch", headers=headers)
    clear_jobs_for_tests()


def test_cancel_sync_job(client: TestClient) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)
    client.put(
        f"{DATA}/channels/cancel-ch",
        json={"name": "cancel-ch", "displayName": "Cancel"},
        headers=headers,
    )

    async def slow_scrape(*_args, **_kwargs):
        import asyncio

        await asyncio.sleep(5)
        return _mock_page_response("cancel-ch", [])

    with patch(
        "app.services.sync_orchestrator.scrape_channel_page",
        new_callable=AsyncMock,
        side_effect=slow_scrape,
    ):
        r = client.post(
            f"{PREFIX}/sync",
            json={"channelIds": ["cancel-ch"], "source": "Test"},
            headers=headers,
        )
        job_id = r.json()["jobId"]

        cancel_r = client.post(f"{PREFIX}/sync/{job_id}/cancel", headers=headers)
        assert cancel_r.status_code == 200
        assert cancel_r.json()["status"] == "cancelled"

        job = get_job(job_id)
        assert job is not None
        assert job.cancel_event.is_set()

    client.delete(f"{DATA}/channels/cancel-ch", headers=headers)
    clear_jobs_for_tests()


def test_sync_job_not_found(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(f"{PREFIX}/sync/does-not-exist", headers=headers)
    assert r.status_code == 404


def test_sync_job_sse_events(client: TestClient) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)

    client.put(
        f"{DATA}/channels/sse-ch",
        json={"name": "sse-ch", "displayName": "SSE"},
        headers=headers,
    )

    with patch(
        "app.services.sync_orchestrator.scrape_channel_page",
        new_callable=AsyncMock,
        return_value=_mock_page_response(
            "sse-ch",
            [
                {
                    "id": 10,
                    "text": "x",
                    "date": "2024-06-01T12:00:00+00:00",
                    "timestamp": 1_716_724_800_000,
                }
            ],
            next_before_id=None,
        ),
    ):
        r = client.post(
            f"{PREFIX}/sync",
            json={"channelIds": ["sse-ch"], "source": "SSETest"},
            headers=headers,
        )
        job_id = r.json()["jobId"]

        events: list[dict] = []
        with client.stream(
            "GET", f"{PREFIX}/sync/{job_id}/events", headers=headers
        ) as stream_r:
            assert stream_r.status_code == 200
            assert "text/event-stream" in stream_r.headers.get("content-type", "")
            for line in stream_r.iter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line.removeprefix("data: ")
                if payload == "[DONE]":
                    break
                events.append(json.loads(payload))

        assert len(events) >= 1
        assert events[0]["jobId"] == job_id
        assert events[-1]["status"] == "completed"
        assert events[-1]["channels"][0]["status"] == "success"

    client.delete(f"{DATA}/channels/sse-ch", headers=headers)
    clear_jobs_for_tests()


def test_sync_incremental_stops_at_existing_post(client: TestClient) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)

    client.put(
        f"{DATA}/channels/incr-ch",
        json={"name": "incr-ch", "displayName": "Incremental"},
        headers=headers,
    )
    client.post(
        f"{DATA}/posts/bulk",
        json=[
            {
                "id": 50,
                "channelName": "incr-ch",
                "text": "existing",
                "date": "2024-01-01",
                "timestamp": 1_700_000_000_000,
            }
        ],
        headers=headers,
    )

    page_posts = [
        {
            "id": 52,
            "text": "new",
            "date": "2024-06-02T12:00:00+00:00",
            "timestamp": 1_716_800_000_000,
        },
        {
            "id": 50,
            "text": "existing",
            "date": "2024-01-01T12:00:00+00:00",
            "timestamp": 1_700_000_000_000,
        },
    ]

    with patch(
        "app.services.sync_orchestrator.scrape_channel_page",
        new_callable=AsyncMock,
        return_value=_mock_page_response("incr-ch", page_posts, next_before_id=49),
    ):
        r = client.post(
            f"{PREFIX}/sync",
            json={"channelIds": ["incr-ch"], "source": "Test"},
            headers=headers,
        )
        job_id = r.json()["jobId"]

        deadline = time.time() + 10
        while time.time() < deadline:
            status_r = client.get(f"{PREFIX}/sync/{job_id}", headers=headers)
            data = status_r.json()
            if data["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(0.1)

        assert data["status"] == "completed"
        assert data["channels"][0]["postsFetched"] == 1

    posts_r = client.get(
        f"{DATA}/posts",
        params={"channelNames": "incr-ch"},
        headers=headers,
    )
    ids = {p["id"] for p in posts_r.json()}
    assert ids == {50, 52}

    client.delete(f"{DATA}/channels/incr-ch", headers=headers)
    clear_jobs_for_tests()


def test_sync_job_persists_to_postgres(client: TestClient) -> None:
    """Job status survives clearing in-memory state (simulated restart)."""
    clear_jobs_for_tests()
    headers = _auth(client)

    client.put(
        f"{DATA}/channels/persist-ch",
        json={"name": "persist-ch", "displayName": "Persist"},
        headers=headers,
    )

    with patch(
        "app.services.sync_orchestrator.scrape_channel_page",
        new_callable=AsyncMock,
        return_value=_mock_page_response(
            "persist-ch",
            [
                {
                    "id": 50,
                    "text": "a",
                    "date": "2024-06-01T12:00:00+00:00",
                    "timestamp": 1_716_724_800_000,
                },
                {
                    "id": 51,
                    "text": "b",
                    "date": "2024-06-01T13:00:00+00:00",
                    "timestamp": 1_716_728_400_000,
                },
            ],
            next_before_id=None,
        ),
    ):
        r = client.post(
            f"{PREFIX}/sync",
            json={"channelIds": ["persist-ch"], "source": "PersistTest"},
            headers=headers,
        )
        job_id = r.json()["jobId"]

        deadline = time.time() + 10
        while time.time() < deadline:
            status_r = client.get(f"{PREFIX}/sync/{job_id}", headers=headers)
            if status_r.json()["status"] == "completed":
                break
            time.sleep(0.1)

        with Session(engine) as session:
            row = session.get(SyncJob, job_id)
            assert row is not None
            assert row.status == "completed"
            assert row.source == "PersistTest"
            assert len(row.channels) == 1
            assert row.channels[0]["channelName"] == "persist-ch"
            assert row.channels[0]["status"] == "success"
            assert row.finished_at is not None

        clear_active_jobs_for_tests()
        assert get_job(job_id) is not None

        status_r = client.get(f"{PREFIX}/sync/{job_id}", headers=headers)
        assert status_r.status_code == 200
        data = status_r.json()
        assert data["status"] == "completed"
        assert data["channels"][0]["postsFetched"] == 2

    client.delete(f"{DATA}/channels/persist-ch", headers=headers)
    clear_jobs_for_tests()


def _wait_for_job(client: TestClient, job_id: str, headers: dict[str, str]) -> dict:
    deadline = time.time() + 10
    data: dict = {}
    while time.time() < deadline:
        status_r = client.get(f"{PREFIX}/sync/{job_id}", headers=headers)
        data = status_r.json()
        if data["status"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(0.1)
    return data


def _forwarded_post() -> dict:
    return {
        "id": 200,
        "text": "Forwarded content",
        "date": "2024-06-01T12:00:00+00:00",
        "timestamp": 1_716_724_800_000,
        "forwardedFrom": "fwd-target-ch",
        "forwardedFromName": "Fwd Target",
    }


def test_sync_auto_follow_enabled_creates_forwarded_channel(client: TestClient) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)

    client.put(
        f"{DATA}/channels/source-ch",
        json={"name": "source-ch", "autoFollowForwarded": True},
        headers=headers,
    )

    with (
        patch(
            "app.services.sync_orchestrator.scrape_channel_page",
            new_callable=AsyncMock,
            return_value=_mock_page_response(
                "source-ch", [_forwarded_post()], next_before_id=None
            ),
        ),
        patch(
            "app.services.sync_orchestrator.get_channel_info",
            new_callable=AsyncMock,
            return_value={
                "displayName": "Fwd Target",
                "photoUrl": "https://example.com/fwd.jpg",
                "isUnavailableOnWebView": False,
            },
        ),
    ):
        r = client.post(
            f"{PREFIX}/sync",
            json={"channelIds": ["source-ch"], "source": "Test"},
            headers=headers,
        )
        data = _wait_for_job(client, r.json()["jobId"], headers)
        assert data["status"] == "completed"

    channels_r = client.get(f"{DATA}/channels", headers=headers)
    names = {c["name"] for c in channels_r.json()}
    assert "fwd-target-ch" in names

    fwd = next(c for c in channels_r.json() if c["name"] == "fwd-target-ch")
    assert fwd["discoveredVia"]["channelName"] == "source-ch"
    assert fwd["discoveredVia"]["postId"] == 200

    client.delete(f"{DATA}/channels/fwd-target-ch", headers=headers)
    client.delete(f"{DATA}/channels/source-ch", headers=headers)
    clear_jobs_for_tests()


def test_sync_auto_follow_disabled_skips_forwarded_channel(client: TestClient) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)

    client.put(
        f"{DATA}/channels/no-follow-ch",
        json={"name": "no-follow-ch", "autoFollowForwarded": False},
        headers=headers,
    )

    with patch(
        "app.services.sync_orchestrator.scrape_channel_page",
        new_callable=AsyncMock,
        return_value=_mock_page_response(
            "no-follow-ch", [_forwarded_post()], next_before_id=None
        ),
    ):
        r = client.post(
            f"{PREFIX}/sync",
            json={"channelIds": ["no-follow-ch"], "source": "Test"},
            headers=headers,
        )
        data = _wait_for_job(client, r.json()["jobId"], headers)
        assert data["status"] == "completed"

    channels_r = client.get(f"{DATA}/channels", headers=headers)
    names = {c["name"] for c in channels_r.json()}
    assert "fwd-target-ch" not in names

    client.delete(f"{DATA}/channels/no-follow-ch", headers=headers)
    clear_jobs_for_tests()


def test_sync_backfill_completes_partial_history_in_multiple_passes(
    client: TestClient,
) -> None:
    """Partial channels resume backfill from oldest stored post across sync runs."""
    clear_jobs_for_tests()
    headers = _auth(client)

    with Session(engine) as session:
        from app.jobs.settings import save_setting

        save_setting(
            session,
            "sync",
            {
                "globalStartTimeMode": "absolute",
                "globalStartTimeValue": "2001-09-09T01:46:40+00:00",
            },
        )
        save_setting(session, "retention", {"postRetentionDays": 0, "logRetentionDays": 0})

    client.put(
        f"{DATA}/channels/backfill-ch",
        json={
            "name": "backfill-ch",
            "displayName": "Backfill",
            "historyCompleteToCutoff": False,
        },
        headers=headers,
    )
    client.post(
        f"{DATA}/posts/bulk",
        json=[
            {
                "id": 200,
                "channelName": "backfill-ch",
                "text": "newest stored",
                "date": "2033-05-18T03:33:20+00:00",
                "timestamp": 2_000_000_000_000,
            }
        ],
        headers=headers,
    )

    async def mock_scrape(
        channel_name: str,
        *,
        before_id: int | None = None,
        **_: object,
    ) -> dict:
        if before_id is None:
            return _mock_page_response(
                channel_name,
                [
                    {
                        "id": 201,
                        "text": "head",
                        "date": "2033-09-09T01:46:40+00:00",
                        "timestamp": 2_100_000_000_000,
                    },
                    {
                        "id": 200,
                        "text": "newest stored",
                        "date": "2033-05-18T03:33:20+00:00",
                        "timestamp": 2_000_000_000_000,
                    },
                ],
                next_before_id=199,
            )
        if before_id == 200:
            return _mock_page_response(
                channel_name,
                [
                    {
                        "id": 198,
                        "text": "mid",
                        "date": "2017-07-14T02:40:00+00:00",
                        "timestamp": 1_500_000_000_000,
                    },
                    {
                        "id": 199,
                        "text": "mid2",
                        "date": "2017-07-14T02:40:00+00:00",
                        "timestamp": 1_500_000_000_000,
                    },
                ],
                next_before_id=197,
            )
        if before_id in (197, 198):
            return _mock_page_response(
                channel_name,
                [
                    {
                        "id": 196,
                        "text": "old",
                        "date": "1985-11-05T03:20:00+00:00",
                        "timestamp": 500_000_000_000,
                    },
                    {
                        "id": 197,
                        "text": "old2",
                        "date": "1985-11-05T03:20:00+00:00",
                        "timestamp": 500_000_000_000,
                    },
                ],
                next_before_id=None,
            )
        return _mock_page_response(channel_name, [], next_before_id=None)

    with (
        patch.object(settings, "SCRAPER_ITERATION_LIMIT", 2),
        patch(
            "app.services.sync_orchestrator.scrape_channel_page",
            new_callable=AsyncMock,
            side_effect=mock_scrape,
        ),
    ):
        r = client.post(
            f"{PREFIX}/sync",
            json={"channelIds": ["backfill-ch"], "source": "Test"},
            headers=headers,
        )
        data = _wait_for_job(client, r.json()["jobId"], headers)
        assert data["status"] == "completed"

    channels_r = client.get(f"{DATA}/channels", headers=headers)
    ch = next(c for c in channels_r.json() if c["name"] == "backfill-ch")
    assert ch["historyCompleteToCutoff"] is False

    posts_r = client.get(
        f"{DATA}/posts",
        params={"channelNames": "backfill-ch"},
        headers=headers,
    )
    backfill_posts = [
        p for p in posts_r.json() if p.get("retrievalPass") == "backfill"
    ]
    assert len(backfill_posts) >= 2

    with (
        patch.object(settings, "SCRAPER_ITERATION_LIMIT", 2),
        patch(
            "app.services.sync_orchestrator.scrape_channel_page",
            new_callable=AsyncMock,
            side_effect=mock_scrape,
        ),
    ):
        r2 = client.post(
            f"{PREFIX}/sync",
            json={"channelIds": ["backfill-ch"], "source": "Test"},
            headers=headers,
        )
        data2 = _wait_for_job(client, r2.json()["jobId"], headers)
        assert data2["status"] == "completed"

    channels_r2 = client.get(f"{DATA}/channels", headers=headers)
    ch2 = next(c for c in channels_r2.json() if c["name"] == "backfill-ch")
    assert ch2["historyCompleteToCutoff"] is True
    assert ch2["anchorPostId"] == 197

    client.delete(f"{DATA}/channels/backfill-ch", headers=headers)
    clear_jobs_for_tests()
