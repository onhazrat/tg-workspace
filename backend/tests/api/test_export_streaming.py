"""Export must stay complete while streaming.

The log viewers are capped, but an export is a backup: it may never be
truncated. It is streamed only so a full dump does not have to fit in memory
at once — the document itself must be unchanged.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.services.data_import_export import stream_export_data
from app.services.logs import DEFAULT_LOG_PAGE_SIZE

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


def _seed_logs(client: TestClient, headers: dict[str, str], count: int) -> None:
    client.post(
        f"{PREFIX}/sync-logs",
        json=[
            {
                "id": f"export-log-{i}",
                "channelName": "ch",
                "status": "success",
                "timestamp": 1_700_000_000_000 + i,
            }
            for i in range(count)
        ],
        headers=headers,
    )


EXPECTED_SECTIONS = {
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


def test_streamed_export_is_a_complete_document(db: Session) -> None:
    """Concatenated chunks must parse, and carry every section."""
    document = json.loads("".join(stream_export_data(db)))

    assert document["version"] == 2
    assert isinstance(document["timestamp"], int)
    assert set(document["data"]) == EXPECTED_SECTIONS
    for section in EXPECTED_SECTIONS:
        assert isinstance(document["data"][section], list)


def test_export_is_valid_json_over_http(client: TestClient) -> None:
    headers = _auth(client)
    r = client.get(f"{PREFIX}/export", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == 2
    assert "data" in body


def test_export_is_not_truncated_by_the_log_page_size(client: TestClient) -> None:
    """The viewer cap must not leak into exports."""
    headers = _auth(client)
    over_page = DEFAULT_LOG_PAGE_SIZE + 25
    _seed_logs(client, headers, over_page)

    listed = client.get(f"{PREFIX}/sync-logs", headers=headers).json()
    exported = client.get(f"{PREFIX}/export", headers=headers).json()
    exported_logs = [
        row
        for row in exported["data"]["sync_logs"]
        if str(row["id"]).startswith("export-log-")
    ]

    assert len(listed) <= DEFAULT_LOG_PAGE_SIZE, "viewer should be capped"
    assert len(exported_logs) == over_page, "export must contain every row"


def test_export_streams_incrementally(db: Session) -> None:
    """Chunks arrive progressively rather than as one buffered blob."""
    chunks = list(stream_export_data(db))
    assert len(chunks) > 1
    assert chunks[0].startswith('{"version":2')
    assert chunks[-1].endswith("}}")
