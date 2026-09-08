from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import cast

from google import genai
from google.genai import types

from app.ai.models import ChatMessage, CompletionResult, EmbeddingResult, ModelInfo

RTL_LANGUAGES = {"Persian", "Arabic", "فارسی", "العربية"}


def _rtl_instruction(language: str) -> str:
    if language in RTL_LANGUAGES:
        return (
            "IMPORTANT: Since this is a Right-to-Left (RTL) language, ensure formatting "
            "is correct for RTL reading."
        )
    return ""


class GeminiProvider:
    name = "gemini"

    def __init__(self, *, api_key: str) -> None:
        """The credential is an argument, never the environment.

        It read `settings.GEMINI_API_KEY` until BYOK-01. A Provider that fetches
        its own credential is a Provider that cannot be told whose money to
        spend, and with per-Account Keys that is the whole feature. Who pays is
        answered upstream by `services/ai_keys.resolve_ai_key`; this class does
        not know and must not.

        Required rather than defaulted for `scoped_select`'s reason: an optional
        credential leaves every existing call site passing nothing and still
        passing tests, on the Operator's key.
        """
        if not api_key:
            raise ValueError("GeminiProvider needs an API key")
        self._api_key = api_key
        self._client: genai.Client | None = None

    def _get_client(self) -> genai.Client:
        if self._client is None:
            self._client = genai.Client(api_key=self._api_key)
        return self._client

    @staticmethod
    def list_models_static() -> list[ModelInfo]:
        return [
            ModelInfo(
                id="gemini-3-flash-preview", label="Gemini 3 Flash", provider="gemini"
            ),
            ModelInfo(
                id="gemini-3.1-pro-preview", label="Gemini 3.1 Pro", provider="gemini"
            ),
            ModelInfo(
                id="gemini-3.1-flash-lite-preview",
                label="Gemini 3.1 Flash Lite",
                provider="gemini",
            ),
        ]

    def list_models_sync(self) -> list[ModelInfo]:
        return self.list_models_static()

    async def list_models(self) -> list[ModelInfo]:
        return self.list_models_static()

    async def complete(
        self,
        prompt: str,
        *,
        model: str,
        temperature: float = 0.7,
        system_instruction: str | None = None,
    ) -> CompletionResult:
        config = types.GenerateContentConfig(temperature=temperature)
        if system_instruction:
            config.system_instruction = system_instruction
        response = await self._get_client().aio.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )
        return CompletionResult(
            text=response.text or "",
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
        config = types.GenerateContentConfig(temperature=temperature)
        if system_instruction:
            config.system_instruction = system_instruction

        if history:
            contents: list[types.Content] = []
            for msg in history:
                role = "user" if msg.role == "user" else "model"
                contents.append(
                    types.Content(role=role, parts=[types.Part(text=msg.text)])
                )
            contents.append(types.Content(role="user", parts=[types.Part(text=prompt)]))
            stream = await self._get_client().aio.models.generate_content_stream(
                model=model, contents=contents, config=config
            )
        else:
            stream = await self._get_client().aio.models.generate_content_stream(
                model=model, contents=prompt, config=config
            )

        async for chunk in stream:
            if chunk.text:
                yield chunk.text

    async def embed(self, texts: list[str], *, model: str) -> EmbeddingResult:
        result = await self._get_client().aio.models.embed_content(
            model=model,
            contents=texts,
        )
        vectors = [list(e.values or []) for e in (result.embeddings or [])]
        dims = len(vectors[0]) if vectors else 0
        return EmbeddingResult(
            vectors=vectors, model=model, provider=self.name, dimensions=dims
        )

    async def translate_batch(
        self,
        items: list[dict[str, str]],
        *,
        target_language: str,
        model: str,
    ) -> list[dict[str, str]]:
        rtl = _rtl_instruction(target_language)
        prompt = f"""Translate the following array of texts to {target_language}.
Preserve markdown, links, and emojis. Return JSON array of {{id, translation}}.
{rtl}

TEXTS:
{json.dumps(items)}"""
        config = types.GenerateContentConfig(
            temperature=0.3,
            response_mime_type="application/json",
        )
        response = await self._get_client().aio.models.generate_content(
            model=model, contents=prompt, config=config
        )
        parsed = json.loads(response.text or "[]")
        return cast(list[dict[str, str]], parsed)
