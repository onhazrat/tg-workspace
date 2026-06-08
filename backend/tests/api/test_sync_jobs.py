"""Integration tests for server-side sync job orchestration."""

from __future__ import annotations

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


def _mock_scrape_response(start_id: int = 100) -> dict:
    return {
        "channelName": "sync-test-ch",
        "displayName": "Sync Test",
        "photoUrl": "https://example.com/photo.jpg",
        "bio": "bio",
        "subscribers": "1K",
        "posts": [
            {
                "id": start_id,
                "text": "Hello world",
                "date": "2024-06-01T12:00:00+00:00",
                "timestamp": 1_716_724_800_000,
            },
            {
                "id": start_id + 1,
                "text": "Second post",
                "date": "2024-06-01T13:00:00+00:00",
                "timestamp": 1_716_728_400_000,
            },
        ],
        "latestId": start_id + 1,
        "telemetry": [
            {
                "success": True,
                "totalDuration": 120,
                "attempts": [{"proxyUrl": "direct", "success": True}],
            }
        ],
    }


def test_start_sync_job_and_poll_status(client: TestClient) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)

    client.put(
        f"{DATA}/channels/sync-test-ch",
        json={"name": "sync-test-ch", "displayName": "Sync Test", "startId": 100},
        headers=headers,
    )

    with patch(
        "app.services.sync_orchestrator.scrape_channel",
        new_callable=AsyncMock,
        return_value=_mock_scrape_response(100),
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

    sync_meta = client.get(f"{DATA}/sync-meta", headers=headers)
    assert sync_meta.status_code == 200
    assert "posts" in sync_meta.json()

    logs_r = client.get(f"{DATA}/sync-logs", headers=headers)
    assert logs_r.status_code == 200
    matching = [l for l in logs_r.json() if l.get("channelName") == "sync-test-ch"]
    assert any(l["status"] == "success" for l in matching)

    client.delete(f"{DATA}/channels/sync-test-ch", headers=headers)
    clear_jobs_for_tests()


def test_cancel_sync_job(client: TestClient) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)
    client.put(
        f"{DATA}/channels/cancel-ch",
        json={"name": "cancel-ch", "displayName": "Cancel", "startId": 1},
        headers=headers,
    )

    async def slow_scrape(*_args, **_kwargs):
        import asyncio

        await asyncio.sleep(5)
        return _mock_scrape_response(1)

    with patch(
        "app.services.sync_orchestrator.scrape_channel",
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


def test_sync_job_persists_to_postgres(client: TestClient) -> None:
    """Job status survives clearing in-memory state (simulated restart)."""
    clear_jobs_for_tests()
    headers = _auth(client)

    client.put(
        f"{DATA}/channels/persist-ch",
        json={"name": "persist-ch", "displayName": "Persist", "startId": 50},
        headers=headers,
    )

    with patch(
        "app.services.sync_orchestrator.scrape_channel",
        new_callable=AsyncMock,
        return_value=_mock_scrape_response(50),
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
