"""SFR-01: a Generate that breaks leaves a Failed Summary and keeps its reason.

Driven over HTTP: open a Summary, report a failure the browser met before it
could start an Attempt through `POST /data/summaries/{id}/failures`, then read
the Summary and its Attempts back. The server, not the browser, decides its
kind from the HTTP status it carried. Attempts the worker runs are SFR-02's,
in `test_summary_attempts_worker.py`.

## Mutation evidence

Watched to fail, one change at a time:

* `failure_kind` not recognising 413 — the refusal case goes red.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import get_superuser_token_headers

V1 = settings.API_V1_STR


@pytest.fixture
def headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


def _open(client: TestClient, headers: dict[str, str]) -> str:
    summary_id = str(uuid.uuid4())
    r = client.post(
        f"{V1}/data/summaries",
        headers=headers,
        json={
            "id": summary_id,
            "scope": {
                "channels": ["chan_a"],
                "window": {"mode": "live", "durationMinutes": 60, "endGapMinutes": 0},
            },
            "extra": {"status": "pending"},
        },
    )
    assert r.status_code == 200, r.text
    return summary_id


def _attempts(
    client: TestClient, headers: dict[str, str], summary_id: str
) -> list[dict[str, Any]]:
    r = client.get(f"{V1}/data/summaries/{summary_id}/attempts", headers=headers)
    assert r.status_code == 200, r.text
    return list(r.json())


def _summary(
    client: TestClient, headers: dict[str, str], summary_id: str
) -> dict[str, Any]:
    r = client.get(f"{V1}/data/summaries/{summary_id}", headers=headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


@pytest.mark.parametrize(
    ("status", "kind"),
    [(413, "limit"), (None, "transient"), (502, "transient"), (409, "other")],
)
def test_a_refusal_before_the_stream_leaves_a_failed_summary(
    client: TestClient, headers: dict[str, str], status: int | None, kind: str
) -> None:
    """The token-limit 413 arrives before any prompt exists, so the Summary
    is Failed with no stored prompt and no Key charged."""
    summary_id = _open(client, headers)

    r = client.post(
        f"{V1}/data/summaries/{summary_id}/failures",
        headers=headers,
        json={"error": "Too many tokens", "status": status, "model": "gemini-x"},
    )

    assert r.status_code == 200, r.text
    assert r.json()["kind"] == kind
    [attempt] = _attempts(client, headers, summary_id)
    assert attempt["outcome"] == "failed"
    assert attempt["kind"] == kind
    assert attempt["error"] == "Too many tokens"
    assert attempt["keyId"] is None
    summary = _summary(client, headers, summary_id)
    assert summary["status"] == "failed"
    assert "promptText" not in summary


def test_attempts_are_numbered_and_listed_newest_last(
    client: TestClient, headers: dict[str, str]
) -> None:
    summary_id = _open(client, headers)
    for status in (None, 429):
        client.post(
            f"{V1}/data/summaries/{summary_id}/failures",
            headers=headers,
            json={"error": "no", "status": status, "model": "gemini-x"},
        )

    attempts = _attempts(client, headers, summary_id)

    assert [(a["attempt"], a["kind"]) for a in attempts] == [
        (1, "transient"),
        (2, "quota"),
    ]


def _fail(client: TestClient, headers: dict[str, str], summary_id: str) -> None:
    r = client.post(
        f"{V1}/data/summaries/{summary_id}/failures",
        headers=headers,
        json={"error": "offline", "status": None, "model": "m"},
    )
    assert r.status_code == 200, r.text


def _history(
    client: TestClient, headers: dict[str, str], **params: str
) -> dict[str, dict[str, Any]]:
    r = client.get(f"{V1}/data/artifacts", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return {row["id"]: row for row in r.json()}


def test_history_counts_failed_attempts_and_filters_by_status(
    client: TestClient, headers: dict[str, str]
) -> None:
    failed = _open(client, headers)
    _fail(client, headers, failed)
    _fail(client, headers, failed)
    pending = _open(client, headers)
    finished = _open(client, headers)
    client.put(
        f"{V1}/data/summaries/{finished}",
        headers=headers,
        json={"text": "done", "status": None},
    )

    everything = _history(client, headers)
    assert everything[failed]["status"] == "failed"
    assert everything[failed]["failedAttempts"] == 2
    assert everything[pending]["failedAttempts"] == 0
    assert everything[finished]["failedAttempts"] == 0
    assert everything[finished]["status"] == "complete"

    assert set(_history(client, headers, status="failed")) == {failed}
    assert set(_history(client, headers, status="pending")) == {pending}


def test_an_attempt_goes_with_its_summary(
    client: TestClient, headers: dict[str, str]
) -> None:
    summary_id = _open(client, headers)
    _fail(client, headers, summary_id)

    assert (
        client.delete(f"{V1}/data/summaries/{summary_id}", headers=headers).status_code
        == 200
    )

    gone = client.get(f"{V1}/data/summaries/{summary_id}/attempts", headers=headers)
    assert gone.status_code == 404


def test_attempts_travel_with_their_summary_through_export_and_import(
    client: TestClient,
    headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
) -> None:
    summary_id = _open(client, headers)
    _fail(client, headers, summary_id)
    exported = client.get(f"{V1}/data/export", headers=headers)
    assert exported.status_code == 200, exported.text
    document = exported.json()
    attempts = document["data"]["summary_attempts"]
    [row] = [a for a in attempts if a["summaryId"] == summary_id]
    assert row["kind"] == "transient"

    # Restored somewhere else, a Summary's Attempts come back with it.
    client.delete(f"{V1}/data/summaries/{summary_id}", headers=headers)
    restored = client.post(f"{V1}/data/import", headers=headers, json=document)
    assert restored.status_code == 200, restored.text
    [attempt] = _attempts(client, headers, summary_id)
    assert (attempt["id"], attempt["kind"]) == (row["id"], "transient")

    # And they never land on a Summary that is not the subject's.
    other = client.get(f"{V1}/users/me", headers=normal_user_token_headers).json()
    refused = client.post(
        f"{V1}/data/import",
        headers=headers,
        params={"subject": other["id"]},
        json={"summary_attempts": [{**row, "id": str(uuid.uuid4())}]},
    )
    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == "Summary not found"
    assert len(_attempts(client, headers, summary_id)) == 1


def test_another_accounts_summary_answers_the_summary_404(
    client: TestClient,
    headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
) -> None:
    summary_id = _open(client, headers)
    other = normal_user_token_headers

    listed = client.get(f"{V1}/data/summaries/{summary_id}/attempts", headers=other)
    reported = client.post(
        f"{V1}/data/summaries/{summary_id}/failures",
        headers=other,
        json={"error": "x", "status": 413, "model": "m"},
    )

    for r in (listed, reported):
        assert r.status_code == 404, r.text
        assert r.json()["detail"] == "Summary not found"
    assert _attempts(client, headers, summary_id) == []
    assert _summary(client, headers, summary_id)["status"] == "pending"
