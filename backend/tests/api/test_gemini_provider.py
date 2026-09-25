"""The Gemini Provider, held to the properties `test_openai_compatible_provider.py`
holds its twin to.

Same scope rule as that module: the vendor's request schema is not ours, so
nothing here pins field names Google chose. What is ours is where the credential
travels, which models reach a dropdown, and how a chat history is turned into
the turns Google reads. The transport is `httpx.MockTransport`, patched in at
`httpx.AsyncClient.__init__` exactly as the twin does, so the real `google-genai`
client builds and sends every request and none of it reaches the network.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from app.ai.models import ChatMessage
from app.ai.providers.gemini import GeminiProvider

SECRET = "AIza-do-not-leak-me"


def _stub(
    monkeypatch: pytest.MonkeyPatch,
    respond: Callable[[httpx.Request], httpx.Response],
) -> list[httpx.Request]:
    captured: list[httpx.Request] = []
    original = httpx.AsyncClient.__init__

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return respond(request)

    def patched(self: httpx.AsyncClient, **kwargs: Any) -> None:
        kwargs["transport"] = httpx.MockTransport(handler)
        original(self, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)
    return captured


def _sse(*texts: str) -> httpx.Response:
    frames = "".join(
        "data: "
        + json.dumps(
            {"candidates": [{"content": {"role": "model", "parts": [{"text": t}]}}]}
        )
        + "\r\n\r\n"
        for t in texts
    )
    return httpx.Response(
        200, content=frames.encode(), headers={"content-type": "text/event-stream"}
    )


def _assert_key_only_in_header(seen: list[httpx.Request]) -> None:
    assert seen, "the stub transport was never reached"
    for request in seen:
        assert SECRET not in str(request.url), f"credential in URL: {request.url}"
        assert SECRET not in request.content.decode(errors="replace")
        assert request.headers["x-goog-api-key"] == SECRET


def test_the_model_list_offers_only_what_can_answer_a_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Embedding-only entries are dropped, the `models/` prefix goes, and the
    list is sorted.

    **Mutation:** drop the `generateContent` filter and `text-embedding-004`
    reaches the summary dropdown, where picking it fails at Artifact time.
    """
    seen = _stub(
        monkeypatch,
        lambda _r: httpx.Response(
            200,
            json={
                "models": [
                    {
                        "name": "models/gemini-zeta",
                        "displayName": "Zeta",
                        "supportedGenerationMethods": [
                            "generateContent",
                            "countTokens",
                        ],
                    },
                    {
                        "name": "models/text-embedding-004",
                        "displayName": "Embedding",
                        "supportedGenerationMethods": ["embedContent"],
                    },
                    # No action list at all is kept: absence is not a refusal.
                    {"name": "models/gemini-alpha"},
                    {"name": "", "supportedGenerationMethods": ["generateContent"]},
                ]
            },
        ),
    )

    models = asyncio.run(GeminiProvider(api_key=SECRET).list_models())

    assert [(m.id, m.label) for m in models] == [
        ("gemini-alpha", "gemini-alpha"),
        ("gemini-zeta", "Zeta"),
    ]
    assert {m.provider for m in models} == {"gemini"}
    _assert_key_only_in_header(seen)


def test_a_stream_yields_each_text_chunk_and_skips_empty_ones(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = _stub(monkeypatch, lambda _r: _sse("one ", "", "two"))
    provider = GeminiProvider(api_key=SECRET)

    async def collect() -> list[str]:
        return [c async for c in provider.stream("hi", model="gemini-x")]

    assert asyncio.run(collect()) == ["one ", "two"]
    _assert_key_only_in_header(seen)


def test_a_chat_history_becomes_alternating_turns_ending_with_the_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Anything that is not the user speaks as `model`, and the new prompt is
    the last user turn. The system instruction travels beside the turns, never
    as one of them.

    **Mutation:** map `assistant` to `assistant` instead of `model` and the
    roles assertion goes red; Gemini rejects any role but these two.
    """
    seen = _stub(monkeypatch, lambda _r: _sse("ok"))
    provider = GeminiProvider(api_key=SECRET)
    history = [
        ChatMessage(role="user", text="first"),
        ChatMessage(role="assistant", text="reply"),
    ]

    async def collect() -> str:
        chunks = [
            c
            async for c in provider.stream(
                "second",
                model="gemini-x",
                system_instruction="be brief",
                history=history,
            )
        ]
        return "".join(chunks)

    assert asyncio.run(collect()) == "ok"
    body = json.loads(seen[0].content)
    turns = [(c["role"], c["parts"][0]["text"]) for c in body["contents"]]
    assert turns == [("user", "first"), ("model", "reply"), ("user", "second")]
    assert "be brief" in json.dumps(body["systemInstruction"])
    _assert_key_only_in_header(seen)


def test_a_provider_without_a_key_is_refused() -> None:
    with pytest.raises(ValueError, match="API key"):
        GeminiProvider(api_key="")
