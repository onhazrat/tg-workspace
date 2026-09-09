"""One Provider class for every endpoint that speaks the OpenAI HTTP API.

**There is no class per vendor and there will not be one.** OpenRouter, Groq,
Together, DeepSeek, Mistral, a local Ollama and a vLLM server are the same four
routes at different addresses, so the difference between them is a base URL an
Account pastes in — data, not code. That is what makes "any Provider they like"
true rather than aspirational.

The base URL is taken exactly as given, normalised only by stripping trailing
slashes. Guessing at a missing `/v1` would be right for OpenRouter and wrong for
half of the local runtimes, and a wrong guess is much harder to debug than a 404
against the address somebody can read back off the form.

**The credential leaves in a header and nowhere else.** One widely-deployed
gateway accepts its key as a query parameter, and this class deliberately does
not: the request body recorded for an AI call is composed from the prompt at the
call site, which is the only reason nothing can capture a credential today, and
a key in the URL would put it back within reach of anything that ever logged
one. `tests/api/test_openai_compatible_provider.py` asserts the URL never carries
it.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any, cast

import httpx

from app.ai.models import ChatMessage, CompletionResult, EmbeddingResult, ModelInfo

#: Generous overall, because a long summary against a slow local model is the
#: normal case rather than the pathological one — but a short connect timeout,
#: so a wrong base URL fails while somebody is still looking at the form.
_TIMEOUT = httpx.Timeout(300.0, connect=10.0)


class OpenAICompatibleError(Exception):
    """A refusal from the endpoint, shaped so `is_credential_rejection` reads it.

    That function duck-types on `code`/`status`/`message` rather than catching a
    class, which is exactly what lets one rejection rule serve two Providers
    with unrelated exception hierarchies. The body is truncated because some
    gateways answer an auth failure with a whole HTML login page.
    """

    def __init__(self, code: int, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class OpenAICompatibleProvider:
    name = "openai_compatible"

    def __init__(self, *, api_key: str, base_url: str) -> None:
        if not api_key:
            raise ValueError("OpenAICompatibleProvider needs an API key")
        if not base_url:
            raise ValueError("OpenAICompatibleProvider needs a base URL")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base_url}/{path}"

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"}

    def _client(self) -> httpx.AsyncClient:
        """The one place this Provider opens a connection.

        One helper rather than three inline constructions, because
        `tests/services/test_egress_seam.py` declares egress *per callable* and
        three entries for one destination would be three things to keep in step.
        That guard is why this exists at all: it walks every `httpx.AsyncClient`
        in `app/` and fails one that is not on its list, after
        `cache_channel_photo` spent five weeks sending avatar requests from the
        deployment's real address.

        **A Lane cannot answer here**, which is the reason the declaration
        gives: Lanes are the Telegram egress seam. Taking one for an AI call
        would hold a proxy permit a sync is waiting on, charge the Telegram
        Request ledger for a Summary, and route somebody's provider key through
        Tor for the anonymity of an address the provider already has on file.
        """
        return httpx.AsyncClient(timeout=_TIMEOUT)

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        async with self._client() as client:
            response = await client.post(
                self._url(path), headers=self._headers(), json=payload
            )
            _raise_for_status(response)
            return cast(dict[str, Any], response.json())

    async def list_models(self) -> list[ModelInfo]:
        """What this endpoint offers, or nothing.

        An endpoint serving no `/models` is not a fault the Account can fix, and
        raising here would exclude precisely the unusual local runtimes this
        class exists to reach. The empty list is the signal the client turns
        into a free-text model id.
        """
        async with self._client() as client:
            response = await client.get(self._url("models"), headers=self._headers())
            _raise_for_status(response)
            body = response.json()
        entries = body.get("data") if isinstance(body, dict) else body
        if not isinstance(entries, list):
            return []
        models = [
            ModelInfo(id=str(entry["id"]), label=str(entry["id"]), provider=self.name)
            for entry in entries
            if isinstance(entry, dict) and entry.get("id")
        ]
        models.sort(key=lambda m: m.id)
        return models

    async def complete(
        self,
        prompt: str,
        *,
        model: str,
        temperature: float = 0.7,
        system_instruction: str | None = None,
    ) -> CompletionResult:
        body = await self._post(
            "chat/completions",
            {
                "model": model,
                "temperature": temperature,
                "messages": _messages(prompt, system_instruction, None),
            },
        )
        return CompletionResult(
            text=_first_message(body),
            prompt=prompt,
            model=model,
            provider=self.name,
        )

    async def stream(
        self,
        prompt: str,
        *,
        model: str,
        temperature: float = 0.7,
        system_instruction: str | None = None,
        history: list[ChatMessage] | None = None,
    ) -> AsyncIterator[str]:
        payload = {
            "model": model,
            "temperature": temperature,
            "stream": True,
            "messages": _messages(prompt, system_instruction, history),
        }
        async with (
            self._client() as client,
            client.stream(
                "POST",
                self._url("chat/completions"),
                headers=self._headers(),
                json=payload,
            ) as response,
        ):
            if response.status_code >= 400:
                # The body has not been read yet on a streaming response, and
                # `.text` on an unread one raises rather than showing the
                # provider's own explanation of the refusal.
                await response.aread()
                _raise_for_status(response)
            async for line in response.aiter_lines():
                chunk = _sse_delta(line)
                if chunk:
                    yield chunk

    async def embed(self, texts: list[str], *, model: str) -> EmbeddingResult:
        body = await self._post("embeddings", {"model": model, "input": texts})
        vectors = [
            [float(v) for v in entry.get("embedding", [])]
            for entry in body.get("data", [])
        ]
        return EmbeddingResult(
            vectors=vectors,
            model=model,
            provider=self.name,
            dimensions=len(vectors[0]) if vectors else 0,
        )

    async def translate_batch(
        self,
        items: list[dict[str, str]],
        *,
        target_language: str,
        model: str,
    ) -> list[dict[str, str]]:
        prompt = (
            f"Translate the following array of texts to {target_language}.\n"
            "Preserve markdown, links, and emojis. Return a JSON array of "
            "{id, translation}.\n\nTEXTS:\n" + json.dumps(items)
        )
        body = await self._post(
            "chat/completions",
            {
                "model": model,
                "temperature": 0.3,
                "response_format": {"type": "json_object"},
                "messages": _messages(prompt, None, None),
            },
        )
        parsed = json.loads(_first_message(body) or "[]")
        if isinstance(parsed, dict):
            # `json_object` mode forces an object at the top level on several
            # endpoints, so the array arrives wrapped under whatever key the
            # model picked. Take the first list value rather than guess a name.
            parsed = next((v for v in parsed.values() if isinstance(v, list)), [])
        return cast(list[dict[str, str]], parsed)


def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code < 400:
        return
    raise OpenAICompatibleError(response.status_code, response.text[:500])


def _messages(
    prompt: str,
    system_instruction: str | None,
    history: list[ChatMessage] | None,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})
    for message in history or []:
        role = "user" if message.role == "user" else "assistant"
        messages.append({"role": role, "content": message.text})
    messages.append({"role": "user", "content": prompt})
    return messages


def _first_message(body: dict[str, Any]) -> str:
    choices = body.get("choices") or []
    if not choices:
        return ""
    return str(choices[0].get("message", {}).get("content") or "")


def _sse_delta(line: str) -> str:
    """One `data:` frame's text, or the empty string for everything else."""
    if not line.startswith("data:"):
        return ""
    payload = line[len("data:") :].strip()
    if not payload or payload == "[DONE]":
        return ""
    try:
        chunk = json.loads(payload)
    except json.JSONDecodeError:
        return ""
    choices = chunk.get("choices") or []
    if not choices:
        return ""
    return str(choices[0].get("delta", {}).get("content") or "")
