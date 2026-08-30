"""The exact wire shape of the log and stats reads.

Same reasoning as `test_discover_projection.py`: response models sit at the HTTP
boundary, so a model that truncates keys or invents `null`s passes every
service-level test. A log's payload is *its table* — `model_to_camel` camelises
whatever columns exist minus `id`/`user_id`/`updated_at` — which makes these
key-set assertions a standing check that a new column was declared too.

`test_purge_reports_a_total_only_for_the_retention_sweep` is the one to read
first. `DELETE /data/logs` answers three different calls with one response
model, and `total` is genuinely absent from two of them. Declaring it as an
optional field would emit `"total": null` there instead, which is the mistake
this whole family of models exists to avoid.
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from tests.utils.tenancy import follow_channels

PREFIX = f"{settings.API_V1_STR}/data"

# The *detail* key sets — `GET /logs/{type}/{id}`, which is where the bodies
# now live. A list page carries these minus HEAVY_*: `GET /logs/sync` shipped
# 56.28 MB for 500 rows, 99.7% of it bodies the viewer renders only for the one
# row an operator expanded.
PUBLISH_KEYS = {
    "id",
    "summaryId",
    "botId",
    "botName",
    "chatId",
    "chatName",
    "status",
    "error",
    "timestamp",
    "fullRequest",
    "fullResponse",
    "textSent",
}
HEAVY_PUBLISH_KEYS = {"fullRequest", "fullResponse", "textSent"}

SYNC_KEYS = {
    "id",
    "channelName",
    "status",
    "postsCount",
    "newLatestId",
    "error",
    "timestamp",
    "source",
    "fullRequest",
    "fullResponse",
}
HEAVY_SYNC_KEYS = {"fullRequest", "fullResponse"}

LLM_KEYS = {
    "id",
    "model",
    "prompt",
    "response",
    "systemInstruction",
    "modelConfig",
    "fullRequest",
    "fullResponse",
    "tokens",
    "duration",
    "status",
    "error",
    "timestamp",
    "type",
}
HEAVY_LLM_KEYS = {
    "prompt",
    "response",
    "systemInstruction",
    "fullRequest",
    "fullResponse",
}
EMBEDDING_KEYS = {
    "id",
    "textCount",
    "tokensEstimated",
    "duration",
    "status",
    "error",
    "timestamp",
}
NETWORK_KEYS = {
    "id",
    "url",
    "method",
    "status",
    "statusCode",
    "error",
    "duration",
    "timestamp",
    "source",
    "proxyUsed",
    "attempts",
    "telemetry",
}
STATS_KEYS = {
    "postCount",
    "channelCount",
    "summaryCount",
    "embeddedPostCount",
    "botCount",
    "destinationCount",
    "publishLogCount",
    "syncLogCount",
    "llmLogCount",
    "embeddingLogCount",
    "networkLogCount",
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


def _now() -> int:
    return int(time.time() * 1000)


def _write(
    client: TestClient, headers: dict[str, str], path: str, row: dict[str, Any]
) -> None:
    r = client.post(f"{PREFIX}/{path}", json=[row], headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"upserted": 1}


def test_publish_logs_keep_their_key_set(client: TestClient) -> None:
    headers = _auth(client)
    _write(
        client,
        headers,
        "logs/publish",
        {
            "id": "p1",
            "summaryId": "s1",
            "botId": "b1",
            "botName": "Bot",
            "chatId": "c1",
            "chatName": "Chat",
            "status": "success",
            "timestamp": _now(),
        },
    )

    rows = client.get(f"{PREFIX}/logs/publish", headers=headers).json()
    assert len(rows) == 1
    assert set(rows[0]) == PUBLISH_KEYS - HEAVY_PUBLISH_KEYS

    detail = client.get(f"{PREFIX}/logs/publish/p1", headers=headers).json()
    assert set(detail) == PUBLISH_KEYS


def test_sync_logs_keep_their_key_set_including_folded_payloads(
    client: TestClient,
) -> None:
    """`fullRequest`/`fullResponse` live in a truncatable side table and are part
    of the **detail** wire shape, reading as null when the payload is gone.

    The list omits them entirely rather than sending nulls — it does not join
    that table at all any more, which is the whole saving."""
    headers = _auth(client)
    _write(
        client,
        headers,
        "logs/sync",
        {
            "id": "sy1",
            "channelName": "ch",
            "status": "success",
            "postsCount": 3,
            "timestamp": _now(),
        },
    )

    rows = client.get(f"{PREFIX}/logs/sync", headers=headers).json()
    assert len(rows) == 1
    assert set(rows[0]) == SYNC_KEYS - HEAVY_SYNC_KEYS
    assert rows[0]["postsCount"] == 3

    detail = client.get(f"{PREFIX}/logs/sync/sy1", headers=headers).json()
    assert set(detail) == SYNC_KEYS
    assert detail["fullRequest"] is None


def test_llm_logs_survive_pydantics_protected_model_prefix(
    client: TestClient,
) -> None:
    """Two traps in one row.

    Pydantic v2 reserves the `model_` prefix, and this table has both a `model`
    column and a `model_config_json` one, so the response model needs
    `protected_namespaces=()` or it cannot even be declared.

    And the wire keys are `modelConfig` and `type` — *not* the camelisations of
    the column names. `_CAMEL_OVERRIDES` renames both explicitly, so declaring
    the obvious aliases silently renames the fields and drops their values.
    """
    headers = _auth(client)
    _write(
        client,
        headers,
        "logs/llm",
        {
            "id": "l1",
            "model": "gemini-2.0-flash",
            "prompt": "hello",
            "response": "hi",
            "modelConfig": {"temperature": 0.7},
            "status": "success",
            "timestamp": _now(),
            "type": "summary",
        },
    )

    rows = client.get(f"{PREFIX}/logs/llm", headers=headers).json()
    assert len(rows) == 1
    assert set(rows[0]) == LLM_KEYS - HEAVY_LLM_KEYS
    assert rows[0]["model"] == "gemini-2.0-flash"
    assert rows[0]["modelConfig"] == {"temperature": 0.7}
    assert rows[0]["type"] == "summary"

    detail = client.get(f"{PREFIX}/logs/llm/l1", headers=headers).json()
    assert set(detail) == LLM_KEYS
    assert detail["prompt"] == "hello"
    assert detail["response"] == "hi"


def test_embedding_logs_keep_their_key_set(client: TestClient) -> None:
    """The route used to declare `dict | list`, which OpenAPI rendered as an
    untyped `anyOf`. The service only ever returns a list."""
    headers = _auth(client)
    _write(
        client,
        headers,
        "logs/embedding",
        {
            "id": "e1",
            "textCount": 12,
            "duration": 1.5,
            "status": "success",
            "timestamp": _now(),
        },
    )

    rows = client.get(f"{PREFIX}/logs/embedding", headers=headers).json()
    assert isinstance(rows, list)
    assert len(rows) == 1
    assert set(rows[0]) == EMBEDDING_KEYS


def test_network_logs_keep_their_key_set(client: TestClient) -> None:
    headers = _auth(client)
    _write(
        client,
        headers,
        "logs/network",
        {
            "id": "n1",
            "url": "https://t.me/s/ch",
            "method": "GET",
            "status": "success",
            "statusCode": 200,
            "duration": 0.4,
            "timestamp": _now(),
            "source": "scrape",
            "proxyUsed": "lane-1",
            "telemetry": {"attempt": 1},
        },
    )

    rows = client.get(f"{PREFIX}/logs/network", headers=headers).json()
    assert len(rows) == 1
    assert set(rows[0]) == NETWORK_KEYS
    assert rows[0]["telemetry"] == {"attempt": 1}


def test_db_stats_is_a_closed_set_of_counts(client: TestClient) -> None:
    body = client.get(f"{PREFIX}/stats", headers=_auth(client)).json()
    assert set(body) == STATS_KEYS
    assert all(isinstance(v, int) for v in body.values())


def test_table_sizes_keep_their_key_set(client: TestClient) -> None:
    rows = client.get(f"{PREFIX}/table-sizes", headers=_auth(client)).json()
    assert rows
    for row in rows:
        assert set(row) == {"name", "count", "size"}


def test_purge_reports_a_total_only_for_the_retention_sweep(
    client: TestClient,
) -> None:
    """Three call shapes, one response model. `total` must stay *absent* on the
    two that do not compute one, not present-and-null."""
    headers = _auth(client)
    _write(
        client,
        headers,
        "logs/publish",
        {
            "id": "purge-1",
            "summaryId": "s1",
            "botId": "b1",
            "botName": "Bot",
            "chatId": "c1",
            "chatName": "Chat",
            "status": "success",
            "timestamp": _now(),
        },
    )

    by_id = client.delete(
        f"{PREFIX}/logs",
        params={"type": "publish", "logId": "purge-1"},
        headers=headers,
    ).json()
    assert by_id == {"deleted": 1}
    assert "total" not in by_id

    cleared = client.delete(
        f"{PREFIX}/logs",
        params={"type": "publish", "clearAll": True},
        headers=headers,
    ).json()
    assert set(cleared) == {"deleted"}

    swept = client.delete(
        f"{PREFIX}/logs", params={"olderThanDays": 30}, headers=headers
    ).json()
    assert set(swept) == {"deleted", "total"}
    # The sweep reports a per-type breakdown, not a bare count.
    assert isinstance(swept["deleted"], dict)
    assert set(swept["deleted"]) == {
        "publish",
        "sync",
        "llm",
        "embedding",
        "network",
    }


def test_clearing_a_table_reports_a_count(client: TestClient) -> None:
    headers = _auth(client)
    r = client.delete(f"{PREFIX}/tables/network_logs", headers=headers)
    assert r.status_code == 200
    assert set(r.json()) == {"deleted"}
    assert isinstance(r.json()["deleted"], int)
