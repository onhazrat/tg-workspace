"""GET /data/sync-logs must stay bounded.

tg_sync_logs stores a full_request/full_response payload per row. Selecting
the whole table loaded every payload into memory at once and OOM-killed the
worker on staging, so the endpoint caps what one request can return.
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.core.config import settings
from app.services.logs import DEFAULT_LOG_PAGE_SIZE, MAX_LOG_PAGE_SIZE

PREFIX = f"{settings.API_V1_STR}/data"


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _seed(
    client: TestClient, headers: dict[str, str], count: int, base_ts: int
) -> None:
    client.post(
        f"{PREFIX}/sync-logs",
        json=[
            {
                "id": f"page-log-{i}",
                "channelName": "ch",
                "status": "success",
                # ascending timestamps so the newest is the highest index
                "timestamp": base_ts + i,
            }
            for i in range(count)
        ],
        headers=headers,
    )


def test_returns_newest_first(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000)
    _seed(client, headers, 5, base)

    body = client.get(f"{PREFIX}/sync-logs", headers=headers).json()
    seeded = [row for row in body if str(row["id"]).startswith("page-log-")]

    timestamps = [row["timestamp"] for row in seeded]
    assert timestamps == sorted(timestamps, reverse=True), "not newest-first"


def test_limit_caps_returned_rows(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000) + 10_000
    _seed(client, headers, 12, base)

    body = client.get(f"{PREFIX}/sync-logs?limit=3", headers=headers).json()
    assert len(body) == 3


def test_offset_pages_through(client: TestClient) -> None:
    headers = _auth(client)
    base = int(time.time() * 1000) + 20_000
    _seed(client, headers, 6, base)

    first = client.get(f"{PREFIX}/sync-logs?limit=2&offset=0", headers=headers).json()
    second = client.get(f"{PREFIX}/sync-logs?limit=2&offset=2", headers=headers).json()

    assert len(first) == 2
    assert len(second) == 2
    assert {r["id"] for r in first}.isdisjoint({r["id"] for r in second})


def test_response_is_a_bare_list(client: TestClient) -> None:
    """The frontend consumes SyncLog[]; keep the shape unchanged."""
    headers = _auth(client)
    body = client.get(f"{PREFIX}/sync-logs", headers=headers).json()
    assert isinstance(body, list)


def test_default_limit_applies_without_params(client: TestClient) -> None:
    headers = _auth(client)
    body = client.get(f"{PREFIX}/sync-logs", headers=headers).json()
    assert len(body) <= DEFAULT_LOG_PAGE_SIZE


def test_limit_is_bounded(client: TestClient) -> None:
    """An unbounded limit would reintroduce the OOM."""
    headers = _auth(client)
    over = client.get(
        f"{PREFIX}/sync-logs?limit={MAX_LOG_PAGE_SIZE + 1}", headers=headers
    )
    assert over.status_code == 422

    assert client.get(f"{PREFIX}/sync-logs?limit=0", headers=headers).status_code == 422
    assert (
        client.get(f"{PREFIX}/sync-logs?offset=-1", headers=headers).status_code == 422
    )
