"""SFR-01: a Generate that breaks leaves a Failed Summary and keeps its reason.

Driven over HTTP the way the browser drives it: open a Summary, stream it
through `POST /ai/summary/stream` naming that Summary, then read the Summary and
its Attempts back. The Provider is a fake handed back from `_provider_for`, as
in `test_ai_chat_stream.py`, so who pays is not under test here.

A failure the browser meets before the stream opens (a token-limit refusal, a
failed sync, a dropped connection) is reported through
`POST /data/summaries/{id}/failures`, and the server, not the browser, decides
its kind from the HTTP status it carried.

## Mutation evidence

Watched to fail, one change at a time:

* `failure_kind` not recognising 429 — the quota case and the numbering
  case go red;
* the disconnect handler recording nothing — the dropped-browser case goes
  red.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.routes import ai_routes
from app.core.config import settings
from app.core.db import engine
from app.services.ai_keys import ResolvedKey
from tests.utils.utils import get_superuser_token_headers

V1 = settings.API_V1_STR
STREAM = f"{V1}/ai/summary/stream"


class _ProviderError(Exception):
    """Shaped like the SDKs' errors: a `code` and a `message`."""

    def __init__(self, code: int | None, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class _FakeProvider:
    def __init__(self) -> None:
        self.chunks: list[str] = ["The ", "report."]
        self.error: BaseException | None = None

    async def stream(self, prompt: str, **_kwargs: Any) -> AsyncIterator[str]:
        for chunk in self.chunks:
            yield chunk
        if self.error is not None:
            raise self.error


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> Iterator[_FakeProvider]:
    fake = _FakeProvider()
    key = ResolvedKey(provider="gemini", api_key="sk-secret", credential_id="key-1")
    monkeypatch.setattr(ai_routes, "_provider_for", lambda *_a, **_k: (fake, key))
    # The fake Key has no row, so there is no validation stamp to clear.
    monkeypatch.setattr(ai_routes, "_note_rejection", lambda *_a: False)
    yield fake


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


def _stream(client: TestClient, headers: dict[str, str], summary_id: str) -> list[str]:
    r = client.post(
        STREAM,
        headers=headers,
        json={
            "channels": ["chan_a"],
            "prompt": "Summarise this.",
            "model": "gemini-x",
            "summaryId": summary_id,
        },
    )
    assert r.status_code == 200, r.text
    return [line.removeprefix("data: ") for line in r.text.split("\n\n") if line]


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


def test_a_finished_answer_records_a_succeeded_attempt(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    summary_id = _open(client, headers)

    frames = _stream(client, headers, summary_id)

    assert frames[-1] == "[DONE]"
    [attempt] = _attempts(client, headers, summary_id)
    assert attempt["attempt"] == 1
    assert attempt["outcome"] == "succeeded"
    assert attempt["kind"] is None
    assert attempt["error"] is None
    assert attempt["model"] == "gemini-x"
    assert attempt["keyId"] == "key-1"
    assert attempt["automatic"] is False
    assert attempt["scheduled"] is False
    assert attempt["endedAt"] >= attempt["startedAt"] > 0
    # The browser saves the text; a succeeding run never marks it failed.
    assert _summary(client, headers, summary_id)["status"] == "pending"


@pytest.mark.parametrize(
    ("code", "kind"),
    [
        (429, "quota"),
        (401, "auth"),
        (403, "auth"),
        (404, "model"),
        (503, "transient"),
        (500, "transient"),
        (None, "transient"),
        (400, "other"),
    ],
)
def test_a_provider_failure_leaves_a_failed_summary_with_its_kind(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
    code: int | None,
    kind: str,
) -> None:
    provider.error = _ProviderError(code, "upstream said no")
    summary_id = _open(client, headers)

    frames = _stream(client, headers, summary_id)

    assert "[DONE]" not in frames
    assert "error" in json.loads(frames[-1])
    [attempt] = _attempts(client, headers, summary_id)
    assert attempt["outcome"] == "failed"
    assert attempt["kind"] == kind
    assert attempt["error"]
    assert "sk-secret" not in attempt["error"]
    assert attempt["model"] == "gemini-x"
    assert attempt["keyId"] == "key-1"
    # What the stream had written before it broke is kept.
    assert attempt["partialText"] == "The report."
    assert _summary(client, headers, summary_id)["status"] == "failed"


def test_an_empty_answer_is_a_failure(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    provider.chunks = ["  "]
    summary_id = _open(client, headers)

    frames = _stream(client, headers, summary_id)

    assert "[DONE]" not in frames
    assert "error" in json.loads(frames[-1])
    [attempt] = _attempts(client, headers, summary_id)
    assert (attempt["outcome"], attempt["kind"]) == ("failed", "empty")
    assert _summary(client, headers, summary_id)["status"] == "failed"


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
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    summary_id = _open(client, headers)
    client.post(
        f"{V1}/data/summaries/{summary_id}/failures",
        headers=headers,
        json={"error": "offline", "status": None, "model": "gemini-x"},
    )
    provider.error = _ProviderError(429, "quota")
    _stream(client, headers, summary_id)

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
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    failed = _open(client, headers)
    _fail(client, headers, failed)
    _fail(client, headers, failed)
    pending = _open(client, headers)
    finished = _open(client, headers)
    _stream(client, headers, finished)
    client.put(
        f"{V1}/data/summaries/{finished}",
        headers=headers,
        json={"text": "done", "status": None},
    )

    everything = _history(client, headers)
    assert everything[failed]["status"] == "failed"
    assert everything[failed]["failedAttempts"] == 2
    assert everything[pending]["failedAttempts"] == 0
    # A succeeded Attempt is not a failed one.
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
    provider: _FakeProvider,
) -> None:
    summary_id = _open(client, headers)
    other = normal_user_token_headers

    listed = client.get(f"{V1}/data/summaries/{summary_id}/attempts", headers=other)
    reported = client.post(
        f"{V1}/data/summaries/{summary_id}/failures",
        headers=other,
        json={"error": "x", "status": 413, "model": "m"},
    )
    streamed = client.post(
        STREAM,
        headers=other,
        json={"channels": [], "prompt": "p", "summaryId": summary_id},
    )

    for r in (listed, reported, streamed):
        assert r.status_code == 404, r.text
        assert r.json()["detail"] == "Summary not found"
    assert _attempts(client, headers, summary_id) == []
    assert _summary(client, headers, summary_id)["status"] == "pending"


def test_a_browser_that_goes_away_mid_stream_leaves_a_transient_failure(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    """A dropped connection cannot be driven through the test client, so the
    stream is closed by hand after its first frame, which is what Starlette
    does to it when the browser disconnects."""
    summary_id = _open(client, headers)
    me = client.get(f"{V1}/users/me", headers=headers).json()
    attempt = ai_routes._Attempt(
        summary_id=summary_id,
        user_id=uuid.UUID(me["id"]),
        model="gemini-x",
        key_id="key-1",
        started_at=1,
    )
    key = ResolvedKey(provider="gemini", api_key="sk", credential_id="key-1")

    async def cut() -> None:
        with Session(engine) as session:
            frames = ai_routes._sse_text(provider.stream("p"), session, key, attempt)
            await anext(frames)
            await frames.aclose()

    asyncio.run(cut())

    [recorded] = _attempts(client, headers, summary_id)
    assert (recorded["outcome"], recorded["kind"]) == ("failed", "transient")
    assert recorded["partialText"] == "The "
    assert _summary(client, headers, summary_id)["status"] == "failed"
