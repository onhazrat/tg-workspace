"""`POST /ai/chat/stream`: what the Provider is asked, and how the stream ends.

The Provider is a fake handed back from `_provider_for`, so who pays is not
under test here (`test_ai_key_payment_rule.py` owns that). What is: the system
prompt a chat is grounded in, and the one rule every stream route shares, that
a failure must never end with the `[DONE]` frame the browser reads as success,
and must end with an `error` frame saying why.
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


class _ProviderError(Exception):
    """Shaped like the SDKs' errors: a `code` and a `message`."""

    def __init__(self, code: int | None, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class _FakeProvider:
    def __init__(self, chunks: list[str], fail_after: bool = False) -> None:
        self.chunks = chunks
        self.fail_after = fail_after
        self.error: BaseException = RuntimeError("API key not valid")
        self.calls: list[dict[str, Any]] = []

    async def stream(self, prompt: str, **kwargs: Any) -> AsyncIterator[str]:
        self.calls.append({"prompt": prompt, **kwargs})
        for chunk in self.chunks:
            yield chunk
        if self.fail_after:
            raise self.error


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> Iterator[_FakeProvider]:
    fake = _FakeProvider(["one ", "two"])
    key = ResolvedKey(
        provider="gemini", api_key="sk-secret-123", credential_id="cred-1"
    )
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
    otherwise render its partial answer as a finished one. The stream ends on
    an `error` frame instead, and the rejection is noted against the Key that
    was spent.

    **Mutation:** yield `[DONE]` after the error frame and the first assertion
    goes red; drop the error frame and the last one does.
    """
    provider.fail_after = True
    noted: list[tuple[str | None, str]] = []

    def note(_session: Any, key: ResolvedKey, exc: BaseException) -> bool:
        noted.append((key.credential_id, str(exc)))
        return True

    monkeypatch.setattr(ai_routes, "_note_rejection", note)

    r = client_post(
        URL,
        {"message": "q", "postsText": "p"},
    )

    assert "[DONE]" not in r.text
    assert _frames(r.text)[0] == json.dumps({"text": "one "})
    assert noted == [("cred-1", "API key not valid")]
    assert "error" in json.loads(_frames(r.text)[-1])


SUMMARY_URL = f"{settings.API_V1_STR}/ai/summary/stream"


@pytest.mark.parametrize(
    ("url", "body"),
    [
        (URL, {"message": "q", "postsText": "p"}),
        (SUMMARY_URL, {"channels": ["chan_a"], "postsText": "p"}),
    ],
)
@pytest.mark.parametrize(
    ("error", "says"),
    [
        (_ProviderError(503, "high demand"), "overloaded"),
        # A spent daily quota is a 429 too, so the Provider's words travel.
        (_ProviderError(429, "quota exceeded for the day"), "quota exceeded"),
        (_ProviderError(401, "bad key"), "rejected by its provider"),
        (_ProviderError(404, "model gemini-9 not found"), "(404): model gemini-9"),
        (_ProviderError(500, "cannot parse body"), "internal error (500)"),
        (_ProviderError(502, "<!DOCTYPE html><html>"), "overloaded"),
        (_ProviderError(400, "<html><body>login</body>"), "an HTML error page"),
        (KeyError("choices"), "failed unexpectedly"),
    ],
)
def test_a_failed_stream_ends_with_the_reason(
    provider: _FakeProvider,
    url: str,
    body: dict[str, Any],
    error: BaseException,
    says: str,
) -> None:
    """The last frame names what went wrong, on every stream route.

    A busy model used to cut the connection, and the browser could only say
    "an unexpected error occurred" about something that needed a retry.

    **Mutation:** return the Provider message for every code and the busy
    cases go red; put 500 back among the busy codes and its case does.
    """
    provider.fail_after = True
    provider.error = error

    r = client_post(url, body)

    frames = _frames(r.text)
    assert "[DONE]" not in frames
    assert says in json.loads(frames[-1])["error"]


def test_the_key_never_reaches_the_error_frame_or_the_log(
    provider: _FakeProvider, caplog: pytest.LogCaptureFixture
) -> None:
    """An endpoint may echo the credential back in its error message.

    **Mutation:** drop the scrub and the secret appears in the frame; log `exc`
    instead of the scrubbed sentence and it appears in the server log.
    """
    provider.fail_after = True
    provider.error = _ProviderError(400, "bad request for key sk-secret-123")

    r = client_post(URL, {"message": "q", "postsText": "p"})

    assert "sk-secret-123" not in r.text
    assert "***" in json.loads(_frames(r.text)[-1])["error"]
    assert "sk-secret-123" not in caplog.text
    assert "AI provider stream failed" in caplog.text


def test_a_key_straddling_the_cut_is_still_scrubbed(provider: _FakeProvider) -> None:
    """The message is truncated for the toast; the Key must go before that.

    **Mutation:** truncate before scrubbing and the Key's first characters
    survive the cut.
    """
    provider.fail_after = True
    # The Key starts at character 296, so a cut at 300 keeps "sk-s".
    provider.error = _ProviderError(400, "x" * 295 + " sk-secret-123 tail")

    r = client_post(URL, {"message": "q", "postsText": "p"})

    assert "sk-s" not in r.text


def test_a_failure_nothing_answered_keeps_its_traceback(
    provider: _FakeProvider, caplog: pytest.LogCaptureFixture
) -> None:
    """A code-less exception may be a bug in this process, so the operator
    gets the stack while the Account gets a sentence that blames nobody.

    **Mutation:** log every failure as the one-line warning and the traceback
    assertion goes red.
    """
    provider.fail_after = True
    provider.error = KeyError("choices")

    client_post(URL, {"message": "q", "postsText": "p"})

    failed = [r for r in caplog.records if r.getMessage().startswith("AI stream")]
    assert failed and failed[0].exc_info is not None


def test_the_summary_stream_sends_the_prompt_it_was_given(
    provider: _FakeProvider,
) -> None:
    """Generate stores its prompt on the pending Summary first, then sends it
    back so the model answers exactly that prompt, built once.

    **Mutation:** ignore `prompt` and rebuild it, and the call carries the
    template instead.
    """
    client_post(
        SUMMARY_URL,
        {"channels": ["chan_a"], "postsText": "p", "prompt": "stored prompt"},
    )

    assert provider.calls[0]["prompt"] == "stored prompt"


def client_post(url: str, body: dict[str, Any]) -> Any:
    lenient = TestClient(app, raise_server_exceptions=False)
    return lenient.post(url, headers=get_superuser_token_headers(lenient), json=body)
