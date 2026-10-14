"""SFR-02: Attempts run on the worker, in a generation Lane of their own.

Driven over HTTP the way the page drives it: start an Attempt on a Summary,
drain one message off the generation Lane by hand (the worker's job), then read
the Summary and its Attempts back. The Provider is a fake handed back from the
runner's one provider seam, so who pays is not under test here; which Key the
Attempt recorded is.

Stop and the SSE watch need the Attempt to be *running* while the test acts, so
those drive the runner and the HTTP calls from one event loop: the fake Provider
yields a chunk and then waits on an `asyncio.Event` the test sets.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core import pg_notify
from app.core.config import settings
from app.core.db import engine
from app.jobs import summary_generation
from app.models_tg import Post
from app.services import prompt_assembly
from app.services.ai_keys import ResolvedKey
from tests.utils.setting_groups import add_test_channel
from tests.utils.utils import get_superuser_token_headers

V1 = settings.API_V1_STR


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
        #: When set, the stream yields its first chunk and then waits here.
        self.hold: asyncio.Event | None = None
        #: When set, the stream waits here before it ends.
        self.hold_end: asyncio.Event | None = None
        self.calls: list[dict[str, Any]] = []

    async def stream(self, prompt: str, **kwargs: Any) -> AsyncIterator[str]:
        self.calls.append({"prompt": prompt, **kwargs})
        for i, chunk in enumerate(self.chunks):
            yield chunk
            if i == 0 and self.hold is not None:
                await self.hold.wait()
        if self.hold_end is not None:
            await self.hold_end.wait()
        if self.error is not None:
            raise self.error


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> Iterator[_FakeProvider]:
    fake = _FakeProvider()
    key = ResolvedKey(provider="gemini", api_key="sk-secret", credential_id="key-1")
    monkeypatch.setattr(
        summary_generation, "_provider_for", lambda *_a, **_k: (fake, key)
    )
    # Every chunk is written through, so a test reads what the worker had.
    monkeypatch.setattr(summary_generation, "FLUSH_SECONDS", 0.0)
    yield fake


@pytest.fixture
def headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


def _open(
    client: TestClient, headers: dict[str, str], *, prompt: str | None = "Go."
) -> str:
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
            "extra": {"status": "failed"},
        },
    )
    assert r.status_code == 200, r.text
    if prompt is not None:
        r = client.put(
            f"{V1}/data/summaries/{summary_id}",
            headers=headers,
            json={"promptText": prompt},
        )
        assert r.status_code == 200, r.text
    return summary_id


def _start(
    client: TestClient, headers: dict[str, str], summary_id: str, **body: Any
) -> Any:
    return client.post(
        f"{V1}/data/summaries/{summary_id}/attempts/start",
        headers=headers,
        json={"model": "m-1", **body},
    )


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


def _drain() -> str | None:
    return asyncio.run(summary_generation.run_next_attempt())


def test_a_started_attempt_runs_on_the_worker_and_finishes_the_summary(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    summary_id = _open(client, headers)

    r = _start(client, headers, summary_id, temperature=0.3)
    assert r.status_code == 200, r.text
    started = r.json()
    assert started["outcome"] == "running"
    assert started["keyId"] == "key-1"
    # Nothing ran in the request: the worker has not drained the Lane yet.
    assert provider.calls == []
    assert _summary(client, headers, summary_id)["text"] == ""

    assert _drain() == started["id"]

    assert provider.calls[0]["prompt"] == "Go."
    assert provider.calls[0]["model"] == "m-1"
    assert provider.calls[0]["temperature"] == 0.3
    summary = _summary(client, headers, summary_id)
    assert summary["text"] == "The report."
    assert summary["model"] == "m-1"
    assert summary["aiKeyId"] == "key-1"
    assert summary.get("status") is None
    assert "promptText" not in summary
    [attempt] = _attempts(client, headers, summary_id)
    assert attempt["outcome"] == "succeeded"
    assert attempt["endedAt"] is not None
    assert _drain() is None


@pytest.mark.parametrize(
    ("code", "kind"),
    [(429, "quota"), (401, "auth"), (404, "model"), (503, "transient"), (400, "other")],
)
def test_a_provider_failure_ends_the_attempt_failed_with_its_kind(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
    code: int,
    kind: str,
) -> None:
    summary_id = _open(client, headers)
    provider.chunks = ["Half a "]
    provider.error = _ProviderError(code, "upstream said no to sk-secret")

    _start(client, headers, summary_id)
    _drain()

    # A transient one is followed by its automatic retry (SFR-03).
    attempt = _attempts(client, headers, summary_id)[0]
    assert attempt["outcome"] == "failed"
    assert attempt["kind"] == kind
    assert attempt["error"]
    assert "sk-secret" not in attempt["error"]
    assert attempt["partialText"] == "Half a "
    summary = _summary(client, headers, summary_id)
    assert summary["status"] == "failed"
    # Still Failed, so the prompt stays for "Use another AI".
    assert summary["promptText"] == "Go."


def test_a_stream_cut_part_way_keeps_what_it_had(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    summary_id = _open(client, headers)
    provider.chunks = ["First half, "]
    provider.error = ConnectionResetError("peer went away")

    _start(client, headers, summary_id)
    _drain()

    attempt = _attempts(client, headers, summary_id)[0]
    assert attempt["outcome"] == "failed"
    assert attempt["kind"] == "transient"
    assert attempt["partialText"] == "First half, "


def test_an_empty_answer_is_a_failure(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    summary_id = _open(client, headers)
    provider.chunks = ["  "]

    _start(client, headers, summary_id)
    _drain()

    [attempt] = _attempts(client, headers, summary_id)
    assert (attempt["outcome"], attempt["kind"]) == ("failed", "empty")
    assert _summary(client, headers, summary_id)["status"] == "failed"


def test_a_second_start_while_one_runs_is_refused(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    summary_id = _open(client, headers)

    assert _start(client, headers, summary_id).status_code == 200
    second = _start(client, headers, summary_id)

    assert second.status_code == 409, second.text
    assert len(_attempts(client, headers, summary_id)) == 1


def test_a_retry_defaults_to_the_last_attempts_model_and_key(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    summary_id = _open(client, headers)
    # Not a transient code, so no automatic retry takes the next number.
    provider.error = _ProviderError(429, "quota")
    _start(client, headers, summary_id, model="m-first")
    _drain()

    provider.error = None
    r = client.post(
        f"{V1}/data/summaries/{summary_id}/attempts/start", headers=headers, json={}
    )
    assert r.status_code == 200, r.text
    assert r.json()["model"] == "m-first"
    assert r.json()["attempt"] == 2
    _drain()

    assert _summary(client, headers, summary_id)["model"] == "m-first"


def test_a_missing_prompt_is_rebuilt_from_the_frozen_scope(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    with Session(engine) as session:
        add_test_channel(session, "chan_a", name="chan_a")
        session.add(
            Post(
                channel_name="chan_a",
                post_id=7,
                text="Rates rose sharply today.",
                timestamp=int(time.time() * 1000) - 10 * 60_000,
            )
        )
        session.commit()
    summary_id = _open(client, headers, prompt=None)
    provider.chunks = ["Rates rose [chan_a #7]."]

    r = _start(client, headers, summary_id)
    assert r.status_code == 200, r.text
    # Stored when it is built, so "Use another AI" has something to copy.
    assert (
        "Rates rose sharply today."
        in _summary(client, headers, summary_id)["promptText"]
    )
    _drain()

    assert "Rates rose sharply today." in provider.calls[0]["prompt"]
    summary = _summary(client, headers, summary_id)
    assert summary["text"] == "Rates rose [chan_a #7]."
    # Citations resolve as they did in the browser: keyed `channel-id`.
    assert summary["citedPosts"]["chan_a-7"]["text"] == "Rates rose sharply today."


def test_a_token_limit_refusal_leaves_a_limit_attempt_and_no_prompt(
    client: TestClient,
    headers: dict[str, str],
    provider: _FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(prompt_assembly, "MAX_PROMPT_TOKENS", -1)
    summary_id = _open(client, headers, prompt=None)

    r = _start(client, headers, summary_id)

    assert r.status_code == 200, r.text
    assert (r.json()["outcome"], r.json()["kind"]) == ("failed", "limit")
    assert r.json()["keyId"] is None
    summary = _summary(client, headers, summary_id)
    assert summary["status"] == "failed"
    assert "promptText" not in summary
    # Nothing was queued: no Key is charged for a prompt that cannot exist.
    assert _drain() is None
    assert provider.calls == []


def test_a_restart_fails_an_attempt_a_dead_worker_had_claimed(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    claimed_id = _open(client, headers)
    queued_id = _open(client, headers)
    claimed = _start(client, headers, claimed_id).json()
    # The worker claimed it, wrote some text and died.
    message = summary_generation.claim_next_attempt()
    assert message is not None and message["attemptId"] == claimed["id"]
    with Session(engine) as session:
        from app.services.summary_attempts import save_progress

        save_progress(session, claimed["id"], "Half")
    queued = _start(client, headers, queued_id).json()

    assert summary_generation.reconcile_interrupted_attempts() == 1

    [dead] = _attempts(client, headers, claimed_id)
    assert (dead["outcome"], dead["kind"]) == ("failed", "transient")
    assert dead["partialText"] == "Half"
    assert _summary(client, headers, claimed_id)["status"] == "failed"
    # Still on the Lane, so it is waiting rather than dead.
    [waiting] = _attempts(client, headers, queued_id)
    assert waiting["outcome"] == "running"
    assert _drain() == queued["id"]


def test_a_foreign_summary_is_the_summary_404(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    missing = str(uuid.uuid4())
    r = _start(client, headers, missing)
    assert (r.status_code, r.json()["detail"]) == (404, "Summary not found")
    r = client.post(
        f"{V1}/data/summaries/{missing}/attempts/{uuid.uuid4()}/stop",
        headers=headers,
    )
    assert (r.status_code, r.json()["detail"]) == (404, "Summary not found")


def test_stop_ends_a_running_attempt_stopped_with_its_text(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    summary_id = _open(client, headers)
    attempt_id = _start(client, headers, summary_id).json()["id"]

    async def run() -> None:
        provider.hold = asyncio.Event()
        # A Listener belongs to the loop that started it; this is a new one.
        pg_notify.reset_listeners_for_tests()
        listener = pg_notify.listener(summary_generation.ATTEMPT_EVENTS_CHANNEL)
        listener.subscribe()
        assert await listener.wait_until_listening()
        runner = asyncio.create_task(summary_generation.run_next_attempt())
        # Wait for the first chunk to reach the row.
        for _ in range(200):
            if (
                provider.calls
                and _attempts(client, headers, summary_id)[0]["partialText"]
            ):
                break
            await asyncio.sleep(0.02)
        r = await asyncio.to_thread(
            client.post,
            f"{V1}/data/summaries/{summary_id}/attempts/{attempt_id}/stop",
            headers=headers,
        )
        assert r.status_code == 200, r.text
        await asyncio.wait_for(runner, timeout=5)

    asyncio.run(run())

    [attempt] = _attempts(client, headers, summary_id)
    assert attempt["outcome"] == "stopped"
    assert attempt["partialText"] == "The "
    summary = _summary(client, headers, summary_id)
    assert summary["status"] == "failed"
    assert summary["text"] == ""
    # A stopped Attempt is finished; stopping it again is refused.
    r = client.post(
        f"{V1}/data/summaries/{summary_id}/attempts/{attempt_id}/stop",
        headers=headers,
    )
    assert r.status_code == 409, r.text


def test_a_watcher_attaching_mid_attempt_sees_all_of_the_text(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    """A page opened mid-Attempt gets what was written, then what arrives.

    The second chunk reaches the watcher over `NOTIFY` before the row has it:
    flushing is slowed to an hour, so the row holds only the first chunk until
    the Attempt ends.
    """
    summary_id = _open(client, headers)
    attempt_id = _start(client, headers, summary_id).json()["id"]

    async def run() -> tuple[list[dict[str, Any]], str | None]:
        provider.hold = asyncio.Event()
        provider.hold_end = asyncio.Event()
        # A Listener belongs to the loop that started it; this is a new one.
        pg_notify.reset_listeners_for_tests()
        listener = pg_notify.listener(summary_generation.ATTEMPT_EVENTS_CHANNEL)
        listener.subscribe()
        assert await listener.wait_until_listening()
        runner = asyncio.create_task(summary_generation.run_next_attempt())
        for _ in range(200):
            if _attempts(client, headers, summary_id)[0]["partialText"]:
                break
            await asyncio.sleep(0.02)
        summary_generation.FLUSH_SECONDS = 3600.0
        frames: list[dict[str, Any]] = []
        row_text_when_seen: str | None = None
        watch = summary_generation.watch_attempt(attempt_id)
        async for frame in watch:
            body = frame.removeprefix("data: ").strip()
            if body == "[DONE]":
                break
            frames.append(json.loads(body))
            if len(frames) == 1:
                provider.hold.set()
            elif len(frames) == 2:
                row_text_when_seen = _attempts(client, headers, summary_id)[0][
                    "partialText"
                ]
                provider.hold_end.set()
        await runner
        return frames, row_text_when_seen

    frames, row_text = asyncio.run(asyncio.wait_for(run(), timeout=15))

    text = "".join(f.get("text", "") for f in frames)
    assert text == "The report."
    assert frames[-1] == {"outcome": "succeeded", "error": None}
    assert row_text == "The ", "the second chunk came from the row, not NOTIFY"


def test_the_watch_route_replays_a_finished_attempt(
    client: TestClient, headers: dict[str, str], provider: _FakeProvider
) -> None:
    summary_id = _open(client, headers)
    attempt_id = _start(client, headers, summary_id).json()["id"]
    _drain()

    r = client.get(
        f"{V1}/data/summaries/{summary_id}/attempts/{attempt_id}/events",
        headers=headers,
    )

    assert r.status_code == 200, r.text
    frames = [line.removeprefix("data: ") for line in r.text.split("\n\n") if line]
    assert frames[-1] == "[DONE]"
    assert json.loads(frames[0]) == {"text": "The report."}
    assert json.loads(frames[-2]) == {"outcome": "succeeded", "error": None}
