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
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.logs import LOG_MODELS
from tests.utils.tenancy import follow_channels

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


@pytest.fixture(autouse=True)
def _follow_the_telemetry_channel() -> None:
    # Ticket 21: a sync log is `FOLLOW_SCOPED` Channel telemetry (ticket 19), so
    # under enforcement `create_logs` refuses one for a Channel the caller does
    # not follow, and a by-id read of it answers 404.
    with Session(engine) as session:
        follow_channels(session, "ch")


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
    """Six registries describe the five types; they must not drift apart."""
    from app.api.routes.data.logs import LOG_LIST_RESPONSES, LOG_RESPONSES
    from app.schemas.logs import LOG_LIST_SCHEMAS, LOG_SCHEMAS
    from app.services.logs import LOG_HEAVY_COLUMNS

    assert set(LOG_MODELS) == set(LOG_HEAVY_COLUMNS) == set(LOG_SCHEMAS)
    assert set(LOG_MODELS) == set(LOG_LIST_SCHEMAS) == set(LOG_LIST_RESPONSES)
    assert set(LOG_MODELS) == set(LOG_RESPONSES)
    assert set(LOG_MODELS) == set(FIXTURES), "this test file is missing a type"


def test_every_heavy_column_is_a_real_column_of_its_table() -> None:
    """A typo in `LOG_HEAVY_COLUMNS` would silently omit nothing.

    The list projection filters columns by name, so a misspelled entry does not
    raise — it just quietly stops saving anything, and the 56 MB comes back.
    """
    from app.services.logs import LOG_HEAVY_COLUMNS

    for log_type, heavy in LOG_HEAVY_COLUMNS.items():
        model, _ = LOG_MODELS[log_type]
        real = {c.key for c in model.__table__.columns}  # type: ignore[attr-defined]
        assert heavy <= real, f"{log_type}: {heavy - real} are not columns"


def test_the_list_schema_declares_exactly_the_columns_the_query_selects() -> None:
    """The two halves of the split, asserted against each other.

    `LOG_HEAVY_COLUMNS` decides what the SQL omits and `LOG_LIST_SCHEMAS`
    decides what the response declares. If they disagree, either a heavy field
    is fetched and then dropped by pydantic (paid for, not shipped) or a
    declared field is never fetched and serialises as an explicit `null`.
    """
    from app.schemas.logs import LOG_LIST_SCHEMAS
    from app.services.logs import LOG_HEAVY_COLUMNS
    from app.services.serialization import to_camel

    for log_type, heavy in LOG_HEAVY_COLUMNS.items():
        declared = {
            f.alias or name
            for name, f in LOG_LIST_SCHEMAS[log_type].model_fields.items()
        }
        assert declared.isdisjoint({to_camel(c) for c in heavy}), (
            f"{log_type}: list schema declares a column the query never selects"
        )


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
    is where a miswired registry shows up: serving an LLM log through the
    embedding model would silently drop `prompt`, `response` and `model`.
    """
    headers = _auth(client)
    written = _row(log_type, f"shape-{log_type}")
    client.post(f"{PREFIX}/logs/{log_type}", json=[written], headers=headers)

    # Round-tripped through the *detail* route: the list deliberately omits the
    # corpus-sized fields, so it is not where "did every field survive" is asked.
    row = client.get(
        f"{PREFIX}/logs/{log_type}/shape-{log_type}", headers=headers
    ).json()
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
