"""`POST /ai/chat/stream`: what the Provider is asked, and how the stream ends.

The Provider is a fake handed back from `_provider_for`, so who pays is not
under test here (`test_ai_key_payment_rule.py` owns that). What is: the system
prompt a chat is grounded in, and the one rule every stream route shares, that
a failure must never end with the `[DONE]` frame the browser reads as success.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai.models import ChatMessage
from app.api.routes import ai_routes
from app.core.config import settings
from app.main import app
from app.services.ai_keys import ResolvedKey
from tests.utils.utils import get_superuser_token_headers

URL = f"{settings.API_V1_STR}/ai/chat/stream"


class _FakeProvider:
    def __init__(self, chunks: list[str], fail_after: bool = False) -> None:
        self.chunks = chunks
        self.fail_after = fail_after
        self.calls: list[dict[str, Any]] = []

    async def stream(self, prompt: str, **kwargs: Any) -> AsyncIterator[str]:
        self.calls.append({"prompt": prompt, **kwargs})
        for chunk in self.chunks:
            yield chunk
        if self.fail_after:
            raise RuntimeError("API key not valid")


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> Iterator[_FakeProvider]:
    fake = _FakeProvider(["one ", "two"])
    key = ResolvedKey(provider="gemini", api_key="k", credential_id="cred-1")
    monkeypatch.setattr(ai_routes, "_provider_for", lambda *_a, **_k: (fake, key))
    yield fake


def _frames(body: str) -> list[str]:
    return [line.removeprefix("data: ") for line in body.split("\n\n") if line]


def test_a_chat_streams_its_chunks_then_done(
    client: TestClient, provider: _FakeProvider
) -> None:
    history = [{"role": "user", "text": "earlier"}]
    r = client.post(
        URL,
        headers=get_superuser_token_headers(client),
        json={
            "message": "what happened?",
            "channels": ["chan_a", "chan_b"],
            "postsText": "### chan_a\n- [ID 1] sample",
            "language": "Persian",
            "history": history,
        },
    )

    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert _frames(r.text) == [
        json.dumps({"text": "one "}),
        json.dumps({"text": "two"}),
        "[DONE]",
    ]
    call = provider.calls[0]
    assert call["prompt"] == "what happened?"
    assert call["history"] == [ChatMessage(role="user", text="earlier")]
    system = call["system_instruction"]
    assert "### CHANNELS IN SCOPE\nchan_a, chan_b" in system
    assert "### chan_a\n- [ID 1] sample" in system
    assert "Right-to-Left" in system


@pytest.mark.parametrize(
    ("rag_mode", "marker"),
    [(False, "### CHANNELS IN SCOPE"), (True, "RELEVANT POSTS:")],
)
def test_rag_mode_picks_the_retrieval_prompt(
    client: TestClient, provider: _FakeProvider, rag_mode: bool, marker: str
) -> None:
    """**Mutation:** swap the two templates and both cases go red."""
    client.post(
        URL,
        headers=get_superuser_token_headers(client),
        json={
            "message": "q",
            "channelsText": "chan_a (news)",
            "postsText": "p",
            "ragMode": rag_mode,
        },
    )

    system = provider.calls[0]["system_instruction"]
    assert marker in system
    if not rag_mode:
        # The client's own description of the scope wins over the bare list.
        assert "### CHANNELS IN SCOPE\nchan_a (news)" in system


def test_a_provider_failure_mid_stream_never_sends_done(
    monkeypatch: pytest.MonkeyPatch, provider: _FakeProvider
) -> None:
    """`sseTextStream` reads `[DONE]` as a clean end, so a revoked Key would
    otherwise render its partial answer as a finished one. The rejection is
    noted against the Key that was spent.

    **Mutation:** swallow the exception instead of re-raising and `[DONE]`
    arrives after the partial text.
    """
    provider.fail_after = True
    noted: list[tuple[str | None, str]] = []

    def note(_session: Any, key: ResolvedKey, exc: BaseException) -> bool:
        noted.append((key.credential_id, str(exc)))
        return True

    monkeypatch.setattr(ai_routes, "_note_rejection", note)
    lenient = TestClient(app, raise_server_exceptions=False)

    r = lenient.post(
        URL,
        headers=get_superuser_token_headers(lenient),
        json={"message": "q", "postsText": "p"},
    )

    assert "[DONE]" not in r.text
    assert json.dumps({"text": "one "}) in r.text
    assert noted == [("cred-1", "API key not valid")]
