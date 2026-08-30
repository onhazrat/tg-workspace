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

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete as sa_delete
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import SyncLog, SyncLogPayload
from app.services.logs import upsert_sync_log
from tests.utils.tenancy import follow_channels

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
    # Ticket 21: a sync log is Channel telemetry (ticket 19), so it is
    # `FOLLOW_SCOPED` — under enforcement it is readable by the followers of the
    # Channel it names and by nobody else. No `user_id`: these read through the
    # client as `FIRST_SUPERUSER`, the operator `follow_channels` defaults to.
    with Session(engine) as session:
        follow_channels(session, "ch")
    client.post(f"{PREFIX}/logs/sync", json=[body], headers=headers)


def _listed(client: TestClient, headers: dict[str, str], log_id: str) -> dict:
    body = client.get(f"{PREFIX}/logs/sync?limit=500", headers=headers).json()
    return next(row for row in body if row["id"] == log_id)


def _detail(client: TestClient, headers: dict[str, str], log_id: str) -> dict:
    """The bodies live here now — the list stopped joining the payload table."""
    response = client.get(f"{PREFIX}/logs/sync/{log_id}", headers=headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


def _truncate_payloads() -> None:
    with Session(engine) as session:
        session.execute(sa_delete(SyncLogPayload))
        session.commit()


def test_payload_round_trips_through_the_api(client: TestClient) -> None:
    """The bodies survive the write; the detail route is where they surface."""
    headers = _auth(client)
    log_id = "payload-round-trip"
    _post_log(client, headers, log_id, timestamp=int(time.time() * 1000))

    row = _detail(client, headers, log_id)
    assert row["fullResponse"] == _body(log_id)
    assert row["fullRequest"] == {"url": f"https://t.me/s/ch?before={log_id}"}


def test_the_list_does_not_carry_the_bodies(client: TestClient) -> None:
    """The saving itself: 56.28 MB for 500 rows, 99.7% of it these two keys."""
    headers = _auth(client)
    log_id = "payload-not-in-list"
    _post_log(client, headers, log_id, timestamp=int(time.time() * 1000))

    row = _listed(client, headers, log_id)

    assert "fullRequest" not in row
    assert "fullResponse" not in row
    assert row["channelName"] == "ch"


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

    listing = client.get(f"{PREFIX}/logs/sync?limit=500", headers=headers)
    assert listing.status_code == 200
    row = next(r for r in listing.json() if r["id"] == log_id)
    assert row["status"] == "success"

    # And the detail route, which *is* the one that reads the truncated table,
    # still answers rather than 404ing on the missing payload row.
    detail = _detail(client, headers, log_id)
    assert detail["fullRequest"] is None
    assert detail["fullResponse"] is None


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


def test_reimport_without_bodies_clears_a_stale_payload() -> None:
    """The clear branch, exercised through the door that still allows a rewrite.

    This used to POST the same log id twice through `/data/logs/sync`. Ticket 19
    made that door **create-only** for follow-scoped telemetry — an id that
    already names a row is refused outright, because `upsert_sync_log`
    overwrites `status`, `error`, `posts_count` and the bodies, so a merge lets
    one Follower rewrite telemetry every other Follower reads. That refusal is
    gated on the flag, so it began applying when ticket 21 PR 4 flipped it, and
    this test started asserting a rewrite the API is meant to refuse.

    The behaviour under test is unchanged and still reachable: `upsert_sync_log`
    has other callers, and `data_import_export` is the one that legitimately
    re-imports arbitrary history. So the test calls the service the importer
    calls, rather than asking the API for something ticket 19 decided it should
    not do. `test_the_api_door_refuses_a_second_write_to_one_log_id` below is
    the other half.
    """
    log_id = "payload-cleared"
    ts = int(time.time() * 1000)
    with Session(engine) as session:
        follow_channels(session, "ch")
        upsert_sync_log(
            session,
            {
                "id": log_id,
                "channelName": "ch",
                "status": "success",
                "timestamp": ts,
                "fullRequest": {"url": "https://t.me/s/ch"},
                "fullResponse": _body(log_id),
            },
        )
        session.commit()
        assert session.get(SyncLogPayload, log_id) is not None

    with Session(engine) as session:
        upsert_sync_log(
            session,
            {
                "id": log_id,
                "channelName": "ch",
                "status": "success",
                "timestamp": ts,
            },
        )
        session.commit()
        assert session.get(SyncLogPayload, log_id) is None


def test_the_api_door_refuses_a_second_write_to_one_log_id(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ticket 19's create-only rule, now that the flag makes it apply.

    Pinned on rather than left to the default: the rule is gated, so with
    enforcement off this door still merges and the test would describe the
    rollback state while claiming to describe this one.

    Written when the test above moved off the API, because the reason it moved
    is itself a claim nothing was asserting: a Follower may append telemetry for
    a Channel they watch and may not rewrite what another Follower already
    recorded. 404 rather than 409, with the string an absent row gets — a
    distinguishable refusal would move the enumeration oracle into the payload.
    """
    monkeypatch.setattr(settings, "TENANCY_ENFORCED", True)
    headers = _auth(client)
    log_id = "payload-create-only"
    ts = int(time.time() * 1000)
    _post_log(client, headers, log_id, timestamp=ts)

    with Session(engine) as session:
        assert session.get(SyncLogPayload, log_id) is not None

    second = client.post(
        f"{PREFIX}/logs/sync",
        json=[
            {
                "id": log_id,
                "channelName": "ch",
                "status": "failed",
                "timestamp": ts,
            }
        ],
        headers=headers,
    )

    assert second.status_code == 404, second.text
    with Session(engine) as session:
        assert session.get(SyncLogPayload, log_id) is not None, (
            "the refused rewrite still cleared the payload it was not allowed to touch"
        )


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
