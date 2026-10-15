"""SFR-03: a failure costs as little as possible.

Driven over HTTP as `test_summary_attempts_worker.py` drives it: start an
Attempt, drain the generation Lane by hand with a fake Provider, then read the
Summary and its Attempts back. A cut-off or stopped Attempt's text is a Partial
response the page can keep, dismiss or restore; a passing overload is retried
once by the worker itself.
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.jobs import summary_generation
from app.models_tg import SummaryAttempt
from app.services.ai_keys import ResolvedKey
from tests.api.test_summary_attempts_worker import (
    _attempts,
    _drain,
    _FakeProvider,
    _open,
    _ProviderError,
    _start,
    _summary,
)
from tests.utils.utils import get_superuser_token_headers

V1 = settings.API_V1_STR


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> _FakeProvider:
    fake = _FakeProvider()
    key = ResolvedKey(provider="gemini", api_key="sk-secret", credential_id="key-1")
    monkeypatch.setattr(
        summary_generation, "_provider_for", lambda *_a, **_k: (fake, key)
    )
    monkeypatch.setattr(summary_generation, "FLUSH_SECONDS", 0.0)
    return fake


@pytest.fixture
def headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


def _cut(client: TestClient, headers: dict[str, str], summary_id: str) -> str:
    """Start an Attempt the Provider cuts off after some text; its id."""
    attempt_id = str(_start(client, headers, summary_id).json()["id"])
    _drain()
    return attempt_id


def _act(
    client: TestClient,
    headers: dict[str, str],
    summary_id: str,
    attempt_id: str,
    action: str,
) -> Any:
    return client.post(
        f"{V1}/data/summaries/{summary_id}/attempts/{attempt_id}/{action}",
        headers=headers,
    )


@pytest.fixture
def cutting(provider: _FakeProvider) -> _FakeProvider:
    """A Provider that writes half an answer and then fails for good."""
    provider.chunks = ["First half, "]
    provider.error = _ProviderError(400, "bad request")
    return provider


# --------------------------------------------------------------------------
# Partial responses
# --------------------------------------------------------------------------


def test_keep_finishes_the_summary_incomplete_with_that_attempts_text(
    client: TestClient,
    headers: dict[str, str],
    cutting: _FakeProvider,
) -> None:
    summary_id = _open(client, headers)
    cut_id = _cut(client, headers, summary_id)

    r = _act(client, headers, summary_id, cut_id, "keep")

    assert r.status_code == 200, r.text
    kept = r.json()
    assert kept["outcome"] == "kept_partial"
    assert (kept["model"], kept["keyId"]) == ("m-1", "key-1")
    summary = _summary(client, headers, summary_id)
    assert summary["text"] == "First half, "
    assert summary["incomplete"] is True
    assert summary.get("status") is None
    assert (summary["model"], summary["aiKeyId"]) == ("m-1", "key-1")
    cut, recorded = _attempts(client, headers, summary_id)
    # Keeping uses the text; it does not take it off the Attempt.
    assert cut["partialText"] == "First half, "
    assert recorded["id"] == kept["id"]


def test_an_incomplete_summary_can_still_be_retried(
    client: TestClient,
    headers: dict[str, str],
    cutting: _FakeProvider,
) -> None:
    summary_id = _open(client, headers)
    _act(client, headers, summary_id, _cut(client, headers, summary_id), "keep")
    cutting.chunks, cutting.error = ["The whole ", "report."], None

    assert _start(client, headers, summary_id).status_code == 200
    _drain()

    summary = _summary(client, headers, summary_id)
    assert summary["text"] == "The whole report."
    assert "incomplete" not in summary


def _incomplete(client: TestClient, headers: dict[str, str]) -> str:
    summary_id = _open(client, headers)
    _act(client, headers, summary_id, _cut(client, headers, summary_id), "keep")
    return summary_id


def test_a_failed_retry_of_an_incomplete_summary_keeps_its_report(
    client: TestClient,
    headers: dict[str, str],
    cutting: _FakeProvider,
) -> None:
    """Story 30: the kept text is still the report; the retry's failure is
    the Attempt's to show, not a reason to hide the text behind Failed."""
    summary_id = _incomplete(client, headers)

    _start(client, headers, summary_id)
    _drain()

    summary = _summary(client, headers, summary_id)
    assert summary["text"] == "First half, "
    assert summary["incomplete"] is True
    assert summary.get("status") is None
    assert _attempts(client, headers, summary_id)[-1]["outcome"] == "failed"


def test_a_stopped_retry_of_an_incomplete_summary_keeps_its_report(
    client: TestClient,
    headers: dict[str, str],
    cutting: _FakeProvider,
) -> None:
    summary_id = _incomplete(client, headers)
    attempt_id = _start(client, headers, summary_id).json()["id"]

    assert _act(client, headers, summary_id, attempt_id, "stop").status_code == 200

    summary = _summary(client, headers, summary_id)
    assert summary["text"] == "First half, "
    assert summary.get("status") is None


def test_history_counts_a_stopped_attempt_as_one_that_did_not_finish(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
) -> None:
    """A Summary whose only Attempt was stopped is Failed; "0 failed attempts"
    on its red card would contradict the chip."""
    summary_id = _open(client, headers)
    attempt_id = _start(client, headers, summary_id).json()["id"]
    _act(client, headers, summary_id, attempt_id, "stop")

    r = client.get(f"{V1}/data/artifacts", headers=headers)

    [row] = [a for a in r.json() if a["id"] == summary_id]
    assert (row["status"], row["failedAttempts"]) == ("failed", 1)


def test_a_failed_retry_of_a_finished_summary_keeps_its_report(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
) -> None:
    summary_id = _open(client, headers)
    _cut(client, headers, summary_id)  # succeeds
    provider.error = _ProviderError(400, "bad request")

    assert _start(client, headers, summary_id).status_code == 200
    _drain()

    summary = _summary(client, headers, summary_id)
    assert summary["text"] == "The report."
    assert summary.get("status") is None


def test_keep_refuses_an_attempt_with_no_partial_response(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
) -> None:
    summary_id = _open(client, headers)
    attempt_id = _cut(client, headers, summary_id)  # succeeds: no Partial response

    r = _act(client, headers, summary_id, attempt_id, "keep")

    assert r.status_code == 409, r.text


def test_dismiss_and_restore_round_trip_without_losing_the_text(
    client: TestClient,
    headers: dict[str, str],
    cutting: _FakeProvider,
) -> None:
    summary_id = _open(client, headers)
    cut_id = _cut(client, headers, summary_id)

    r = _act(client, headers, summary_id, cut_id, "dismiss")
    assert r.status_code == 200, r.text
    assert r.json()["partialDismissedAt"] is not None
    assert r.json()["partialText"] == "First half, "

    r = _act(client, headers, summary_id, cut_id, "restore")
    assert r.status_code == 200, r.text
    assert r.json()["partialDismissedAt"] is None
    [attempt] = _attempts(client, headers, summary_id)
    assert attempt["partialText"] == "First half, "


def test_a_dismissed_partial_response_is_trimmed_after_the_deployment_window(
    client: TestClient,
    headers: dict[str, str],
    cutting: _FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.jobs.retention import run_retention_cleanup

    monkeypatch.setattr(settings, "SUMMARY_PARTIAL_DISMISSED_RETENTION_DAYS", 7)
    old_id = _open(client, headers)
    old_cut = _cut(client, headers, old_id)
    _act(client, headers, old_id, old_cut, "dismiss")
    fresh_id = _open(client, headers)
    fresh_cut = _cut(client, headers, fresh_id)
    _act(client, headers, fresh_id, fresh_cut, "dismiss")
    kept_id = _open(client, headers)
    _cut(client, headers, kept_id)
    eight_days_ago = int(time.time() * 1000) - 8 * 86_400_000
    with Session(engine) as session:
        row = session.get(SummaryAttempt, old_cut)
        assert row is not None
        row.partial_dismissed_at = eight_days_ago
        session.add(row)
        session.commit()

    with Session(engine) as session:
        run_retention_cleanup(session)

    [trimmed] = _attempts(client, headers, old_id)
    # Its text goes; the Attempt and why it failed stay.
    assert trimmed["partialText"] is None
    assert trimmed["error"]
    assert _attempts(client, headers, fresh_id)[0]["partialText"] == "First half, "
    assert _attempts(client, headers, kept_id)[0]["partialText"] == "First half, "


# --------------------------------------------------------------------------
# The automatic retry
# --------------------------------------------------------------------------


@pytest.fixture
def no_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    """The retry's ten seconds, made nothing so the Lane drains it now."""
    monkeypatch.setattr(summary_generation, "RETRY_DELAY_SECONDS", 0.0)


def test_a_transient_failure_is_retried_exactly_once(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
    no_wait: None,
) -> None:
    summary_id = _open(client, headers)
    provider.error = _ProviderError(503, "overloaded")

    _start(client, headers, summary_id)
    _drain()

    first, retry = _attempts(client, headers, summary_id)
    assert (first["outcome"], first["kind"]) == ("failed", "transient")
    assert (retry["outcome"], retry["automatic"]) == ("running", True)
    assert (retry["model"], retry["keyId"]) == (first["model"], first["keyId"])
    assert _drain() == retry["id"]
    # The automatic Attempt failed the same way and is not retried again.
    assert [a["outcome"] for a in _attempts(client, headers, summary_id)] == [
        "failed",
        "failed",
    ]
    assert _drain() is None


def test_the_retry_waits_ten_seconds_or_what_the_provider_asked(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
) -> None:
    summary_id = _open(client, headers)
    provider.error = _ProviderError(503, "overloaded")
    _start(client, headers, summary_id)
    before = int(time.time() * 1000)
    _drain()
    plain = _attempts(client, headers, summary_id)[-1]

    other_id = _open(client, headers)
    error = _ProviderError(529, "overloaded")
    error.retry_after = 42  # type: ignore[attr-defined]
    provider.error = error
    _start(client, headers, other_id)
    _drain()
    asked = _attempts(client, headers, other_id)[-1]

    assert 9_000 <= plain["startedAt"] - before <= 12_000
    assert 41_000 <= asked["startedAt"] - before <= 45_000
    # Not due yet, so the worker has nothing to run.
    assert _drain() is None


@pytest.mark.parametrize("code", [429, 401, 404, 400])
def test_no_other_failure_is_retried_automatically(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
    no_wait: None,
    code: int,
) -> None:
    summary_id = _open(client, headers)
    provider.error = _ProviderError(code, "no")

    _start(client, headers, summary_id)
    _drain()

    assert len(_attempts(client, headers, summary_id)) == 1
    assert _drain() is None


def test_an_empty_answer_is_not_retried(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
    no_wait: None,
) -> None:
    summary_id = _open(client, headers)
    provider.chunks = [" "]

    _start(client, headers, summary_id)
    _drain()

    assert len(_attempts(client, headers, summary_id)) == 1


def test_cancel_withdraws_the_queued_retry(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
    no_wait: None,
) -> None:
    summary_id = _open(client, headers)
    provider.error = _ProviderError(503, "overloaded")
    _start(client, headers, summary_id)
    _drain()
    retry = _attempts(client, headers, summary_id)[-1]

    r = _act(client, headers, summary_id, retry["id"], "cancel")

    assert r.status_code == 200, r.text
    assert [a["outcome"] for a in _attempts(client, headers, summary_id)] == ["failed"]
    assert _summary(client, headers, summary_id)["status"] == "failed"
    # Nothing is left to run, and the page may retry by hand straight away.
    assert _drain() is None
    assert len(provider.calls) == 1
    provider.error = None
    assert _start(client, headers, summary_id).status_code == 200


def test_an_attempt_the_worker_has_claimed_cannot_be_cancelled(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
) -> None:
    summary_id = _open(client, headers)
    attempt_id = _start(client, headers, summary_id).json()["id"]
    assert summary_generation.claim_next_attempt() is not None

    r = _act(client, headers, summary_id, attempt_id, "cancel")

    assert r.status_code == 409, r.text
    assert _attempts(client, headers, summary_id)[0]["outcome"] == "running"


# --------------------------------------------------------------------------
# History while an Attempt runs
# --------------------------------------------------------------------------


def _history(
    client: TestClient, headers: dict[str, str], **params: str
) -> dict[str, dict[str, Any]]:
    r = client.get(f"{V1}/data/artifacts", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return {row["id"]: row for row in r.json() if row["kind"] == "summary"}


def test_history_shows_a_summary_with_a_running_attempt_as_running(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
) -> None:
    """A fresh Generate is stored Failed (so a dropped network leaves it Failed)
    and must not read as Failed while its first Attempt runs."""
    summary_id = _open(client, headers)
    dropped_id = _open(client, headers)  # the network went before the start
    _start(client, headers, summary_id)

    assert _history(client, headers)[summary_id]["status"] == "running"
    failed = _history(client, headers, status="failed")
    assert summary_id not in failed
    assert failed[dropped_id]["status"] == "failed"


def test_a_summary_counting_down_to_its_retry_is_still_failed(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
) -> None:
    summary_id = _open(client, headers)
    provider.error = _ProviderError(503, "overloaded")
    _start(client, headers, summary_id)
    _drain()

    assert _history(client, headers, status="failed")[summary_id]["status"] == "failed"


def test_retention_reaches_attempts_only_through_the_trim() -> None:
    """Attempts are on neither log inventory (ADR-030); the trim is declared.

    The retention job may clear a dismissed Partial response's text through
    the aggregate and nothing else: naming the table or model there is the
    first step to pruning a Summary's history with the logs.
    """
    import pathlib

    from app.jobs import retention

    source = pathlib.Path(retention.__file__).read_text()
    assert "trim_dismissed_partials" in source
    assert "SummaryAttempt" not in source
    assert "tg_summary_attempts" not in source
