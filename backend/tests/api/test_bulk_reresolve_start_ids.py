"""Tests for bulk reset-sync API (bulk-reresolve is deprecated)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.config import settings
from app.services.scraper_jobs import clear_jobs_for_tests

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


def test_bulk_reresolve_is_deprecated_noop(client: TestClient, tg_test_channel) -> None:
    headers = _auth(client)
    tg_test_channel("bulk-ch-1", start_id=3, start_time=0)

    r = client.post(
        f"{DATA}/channels/bulk-reresolve-start-ids",
        json={"dryRun": True},
        headers=headers,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["deprecated"] is True
    assert data["updated"] == 0


def test_bulk_reset_sync_requires_confirm(client: TestClient, tg_test_channel) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)
    tg_test_channel("bulk-reset-ch", start_id=100, start_time=1_700_000_000_000)

    r = client.post(
        f"{DATA}/channels/bulk-reset-sync",
        json={"confirm": False, "channelIds": ["bulk-reset-ch"]},
        headers=headers,
    )
    assert r.status_code == 400


def test_bulk_reset_sync_queues_job(
    client: TestClient, tg_test_channel
) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)
    tg_test_channel("bulk-reset-ch-2", start_id=100, start_time=1_700_000_000_000)

    client.put(
        f"{DATA}/channels/bulk-reset-ch-2",
        json={"name": "bulk-reset-ch-2", "startId": 100},
        headers=headers,
    )
    client.post(
        f"{DATA}/posts/bulk",
        json=[
            {
                "id": 100,
                "channelName": "bulk-reset-ch-2",
                "text": "hello",
                "date": "2024-01-01",
                "timestamp": 1_700_000_000_000,
            }
        ],
        headers=headers,
    )

    with (
        patch("app.services.bulk_channels.asyncio.create_task") as mock_task,
        patch(
            "app.services.sync_orchestrator.scrape_channel_page",
            new_callable=AsyncMock,
            return_value={"posts": [], "latestId": 100, "channelName": "bulk-reset-ch-2"},
        ),
    ):
        mock_task.return_value = None
        r = client.post(
            f"{DATA}/channels/bulk-reset-sync",
            json={"confirm": True, "channelIds": ["bulk-reset-ch-2"]},
            headers=headers,
        )

    assert r.status_code == 200
    body = r.json()
    assert body["channelsReset"] == 1
    assert body["postsDeleted"] == 1
    assert body["jobId"]

    ch = client.get(f"{DATA}/channels", headers=headers)
    match = next(row for row in ch.json() if row["id"] == "bulk-reset-ch-2")
    assert match["anchorPostId"] is None
    assert match["historyCompleteToCutoff"] is True
