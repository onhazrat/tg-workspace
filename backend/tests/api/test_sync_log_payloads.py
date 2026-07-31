"""Sync log bodies live in tg_sync_log_payloads, not tg_sync_logs.

They were split off so the payload table can be truncated at any moment to
reclaim disk — a bulk DELETE never returns space to the OS, and the VACUUM FULL
that would needs free space equal to the table it rewrites, which is exactly
what is missing once logs have filled the disk.

Two properties have to hold for that to be safe, and they are what these tests
pin: the split is invisible through the API, and losing the payload table
degrades a sync log rather than breaking it.

Sessions here are short-lived `with Session(engine)` blocks, matching
tests/services/test_logs_bulk_delete.py: the autouse teardown truncates the tg_
tables, which blocks behind any session still holding an open transaction.
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient
from sqlalchemy import delete as sa_delete
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import SyncLog, SyncLogPayload

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


def _body(log_id: str) -> dict[str, object]:
    return {"html": "x" * 128, "id": log_id}


def _post_log(
    client: TestClient,
    headers: dict[str, str],
    log_id: str,
    *,
    timestamp: int,
    with_payload: bool = True,
) -> None:
    body: dict[str, object] = {
        "id": log_id,
        "channelName": "ch",
        "status": "success",
        "timestamp": timestamp,
    }
    if with_payload:
        body["fullRequest"] = {"url": f"https://t.me/s/ch?before={log_id}"}
        body["fullResponse"] = _body(log_id)
    client.post(f"{PREFIX}/sync-logs", json=[body], headers=headers)


def _listed(client: TestClient, headers: dict[str, str], log_id: str) -> dict:
    body = client.get(f"{PREFIX}/sync-logs?limit=500", headers=headers).json()
    return next(row for row in body if row["id"] == log_id)


def _truncate_payloads() -> None:
    with Session(engine) as session:
        session.execute(sa_delete(SyncLogPayload))
        session.commit()


def test_payload_round_trips_through_the_api(client: TestClient) -> None:
    """The wire shape did not change when the columns moved."""
    headers = _auth(client)
    log_id = "payload-round-trip"
    _post_log(client, headers, log_id, timestamp=int(time.time() * 1000))

    row = _listed(client, headers, log_id)
    assert row["fullResponse"] == _body(log_id)
    assert row["fullRequest"] == {"url": f"https://t.me/s/ch?before={log_id}"}


def test_bodies_are_stored_off_the_log_table(client: TestClient) -> None:
    """The point of the split: tg_sync_logs itself carries none of the bulk."""
    headers = _auth(client)
    log_id = "payload-stored-apart"
    _post_log(client, headers, log_id, timestamp=int(time.time() * 1000))

    assert not hasattr(SyncLog, "full_response")
    with Session(engine) as session:
        payload = session.get(SyncLogPayload, log_id)
        assert payload is not None
        assert payload.full_response == _body(log_id)


def test_logs_survive_truncating_the_payload_table(client: TestClient) -> None:
    """The operator's panic button must not break the Logs view.

    TRUNCATE tg_sync_log_payloads is the documented way to free disk instantly.
    Afterwards every sync log still lists, reporting null bodies.
    """
    headers = _auth(client)
    log_id = "payload-truncate-safe"
    _post_log(client, headers, log_id, timestamp=int(time.time() * 1000))

    _truncate_payloads()

    listing = client.get(f"{PREFIX}/sync-logs?limit=500", headers=headers)
    assert listing.status_code == 200
    row = next(r for r in listing.json() if r["id"] == log_id)
    assert row["status"] == "success"
    assert row["fullRequest"] is None
    assert row["fullResponse"] is None


def test_log_without_bodies_stores_no_payload_row(client: TestClient) -> None:
    """Empty payload rows would defeat the point of splitting them out."""
    headers = _auth(client)
    log_id = "payload-absent"
    _post_log(
        client, headers, log_id, timestamp=int(time.time() * 1000), with_payload=False
    )

    with Session(engine) as session:
        assert session.get(SyncLog, log_id) is not None
        assert session.get(SyncLogPayload, log_id) is None


def test_reimport_without_bodies_clears_a_stale_payload(client: TestClient) -> None:
    headers = _auth(client)
    log_id = "payload-cleared"
    ts = int(time.time() * 1000)
    _post_log(client, headers, log_id, timestamp=ts)
    with Session(engine) as session:
        assert session.get(SyncLogPayload, log_id) is not None

    _post_log(client, headers, log_id, timestamp=ts, with_payload=False)
    with Session(engine) as session:
        assert session.get(SyncLogPayload, log_id) is None


def test_deleting_a_log_deletes_its_payload(client: TestClient) -> None:
    """There is no FK to cascade from, so the delete paths clean up by hand."""
    headers = _auth(client)
    log_id = "payload-deleted-with-log"
    _post_log(client, headers, log_id, timestamp=int(time.time() * 1000))

    deleted = client.delete(f"{PREFIX}/logs?type=sync&logId={log_id}", headers=headers)
    assert deleted.status_code == 200

    with Session(engine) as session:
        assert session.get(SyncLog, log_id) is None
        assert session.get(SyncLogPayload, log_id) is None


def test_clear_all_sync_logs_clears_payloads(client: TestClient) -> None:
    headers = _auth(client)
    log_id = "payload-cleared-with-all"
    _post_log(client, headers, log_id, timestamp=int(time.time() * 1000))

    cleared = client.delete(f"{PREFIX}/logs?type=sync&clearAll=true", headers=headers)
    assert cleared.status_code == 200

    with Session(engine) as session:
        assert session.get(SyncLogPayload, log_id) is None


def test_export_includes_payloads(client: TestClient) -> None:
    """An export must stay complete even though the bodies moved tables."""
    headers = _auth(client)
    log_id = "payload-exported"
    _post_log(client, headers, log_id, timestamp=int(time.time() * 1000))

    export = client.get(f"{PREFIX}/export", headers=headers)
    assert export.status_code == 200
    exported = next(
        row for row in export.json()["data"]["sync_logs"] if row["id"] == log_id
    )
    assert exported["fullResponse"] == _body(log_id)


def test_export_keeps_logs_whose_payload_was_reclaimed(client: TestClient) -> None:
    """Outer join, not inner: a reclaimed payload must not drop the log."""
    headers = _auth(client)
    log_id = "payload-exported-without-body"
    _post_log(client, headers, log_id, timestamp=int(time.time() * 1000))

    _truncate_payloads()

    export = client.get(f"{PREFIX}/export", headers=headers)
    exported = next(
        row for row in export.json()["data"]["sync_logs"] if row["id"] == log_id
    )
    assert exported["status"] == "success"
    assert exported["fullResponse"] is None
