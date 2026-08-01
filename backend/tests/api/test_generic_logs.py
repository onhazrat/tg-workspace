"""`GET`/`POST /data/logs/{log_type}` serve all five log kinds (D1).

The point of these tests is **equivalence**: the generic endpoint must return
byte-identical payloads to the per-type alias it replaces, for every type. If
that holds, D2 can delete the ten aliases without touching the frontend's
expectations — and if it ever stops holding, the deletion becomes a silent
breaking change.

The equivalence tests below ran green against both the aliases and the generic
route while D1's aliases still existed; that is what licensed D2 to delete them.
They now compare the generic route against itself for the write path, and the
per-type parametrisation is what keeps all five kinds covered.
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.services.logs import LOG_MODELS

PREFIX = f"{settings.API_V1_STR}/data"

#: One minimal-but-valid row per log type, plus the pre-D2 alias path it used
#: to live at — retained only so `test_the_per_type_aliases_are_gone` can assert
#: those paths stay deleted.
FIXTURES: dict[str, tuple[str, dict[str, Any]]] = {
    "publish": (
        "publish-logs",
        {
            "summaryId": "s1",
            "botId": "b1",
            "botName": "Bot",
            "chatId": "c1",
            "chatName": "Chat",
            "status": "success",
        },
    ),
    "sync": ("sync-logs", {"channelName": "ch", "status": "success", "postsCount": 2}),
    "llm": (
        "llm-logs",
        {"model": "m", "prompt": "p", "response": "r", "status": "success"},
    ),
    "embedding": ("embedding-logs", {"textCount": 3, "duration": 1.0, "status": "ok"}),
    "network": (
        "network-logs",
        {"url": "https://t.me/x", "method": "GET", "status": "ok", "duration": 0.2},
    ),
}


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _row(log_type: str, row_id: str) -> dict[str, Any]:
    _, body = FIXTURES[log_type]
    return {**body, "id": row_id, "timestamp": int(time.time() * 1000)}


def test_the_registries_cover_exactly_the_same_log_types() -> None:
    """Three registries describe the five types; they must not drift apart."""
    from app.api.routes.data.logs import LOG_RESPONSES
    from app.schemas.logs import LOG_SCHEMAS
    from app.services.logs import LOG_LISTERS

    assert set(LOG_MODELS) == set(LOG_LISTERS) == set(LOG_SCHEMAS)
    assert set(LOG_MODELS) == set(LOG_RESPONSES)
    assert set(LOG_MODELS) == set(FIXTURES), "this test file is missing a type"


@pytest.mark.parametrize("log_type", sorted(FIXTURES))
def test_generic_write_then_read_round_trips(client: TestClient, log_type: str) -> None:
    headers = _auth(client)
    written = client.post(
        f"{PREFIX}/logs/{log_type}",
        json=[_row(log_type, f"generic-{log_type}")],
        headers=headers,
    )
    assert written.status_code == 200, written.text
    assert written.json() == {"upserted": 1}

    read = client.get(f"{PREFIX}/logs/{log_type}", headers=headers)
    assert read.status_code == 200
    rows = read.json()
    assert len(rows) == 1
    assert rows[0]["id"] == f"generic-{log_type}"


@pytest.mark.parametrize("log_type", sorted(FIXTURES))
def test_each_type_keeps_its_own_shape_through_the_shared_route(
    client: TestClient, log_type: str
) -> None:
    """One endpoint, five payload shapes.

    The generic route picks the response model from the path parameter, so this
    is where a mis-wired registry shows up: serving an LLM log through the
    embedding model would silently drop `prompt`, `response` and `model`.
    """
    headers = _auth(client)
    written = _row(log_type, f"shape-{log_type}")
    client.post(f"{PREFIX}/logs/{log_type}", json=[written], headers=headers)

    rows = client.get(f"{PREFIX}/logs/{log_type}", headers=headers).json()
    row = next(r for r in rows if r["id"] == f"shape-{log_type}")
    for key, value in written.items():
        assert row[key] == value, f"{log_type}.{key} did not round-trip"


def test_paging_bounds_are_enforced_on_the_generic_route(
    client: TestClient,
) -> None:
    """The cap is the reason these reads are paged at all — an unbounded select
    over a log table can materialise gigabytes."""
    headers = _auth(client)
    assert (
        client.get(f"{PREFIX}/logs/sync", params={"limit": 0}, headers=headers)
    ).status_code == 422
    assert (
        client.get(f"{PREFIX}/logs/sync", params={"limit": 100_000}, headers=headers)
    ).status_code == 422
    assert (
        client.get(f"{PREFIX}/logs/sync", params={"offset": -1}, headers=headers)
    ).status_code == 422


def test_an_unknown_log_type_is_a_400_on_both_verbs(client: TestClient) -> None:
    """400, not 404 — matching what `DELETE /logs?type=…` has always returned."""
    headers = _auth(client)
    assert client.get(f"{PREFIX}/logs/nonsense", headers=headers).status_code == 400
    assert (
        client.post(f"{PREFIX}/logs/nonsense", json=[], headers=headers).status_code
        == 400
    )


def test_the_per_type_aliases_are_gone() -> None:
    """D2 removed them. `/logs/{log_type}` is the only way in.

    Asserted rather than assumed: an alias left behind would keep working, keep
    passing every other test, and quietly preserve the duplication this
    workstream exists to remove.
    """
    from app.main import app

    paths = app.openapi()["paths"]
    for alias, _ in FIXTURES.values():
        assert f"/api/v1/data/{alias}" not in paths, f"{alias} still mounted"

    assert "/api/v1/data/logs/{log_type}" in paths
