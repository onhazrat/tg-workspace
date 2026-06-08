from __future__ import annotations

import json
from collections.abc import AsyncIterator

from google import genai
from google.genai import types

from app.ai.models import ChatMessage, CompletionResult, EmbeddingResult, ModelInfo
from app.core.config import settings

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

    def __init__(self) -> None:
        self._client: genai.Client | None = None

    def _get_client(self) -> genai.Client:
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY not configured")
        if self._client is None:
            self._client = genai.Client(api_key=settings.GEMINI_API_KEY)
        return self._client

    @staticmethod
    def list_models_static() -> list[ModelInfo]:
        return [
            ModelInfo(id="gemini-3-flash-preview", label="Gemini 3 Flash", provider="gemini"),
            ModelInfo(id="gemini-3.1-pro-preview", label="Gemini 3.1 Pro", provider="gemini"),
            ModelInfo(id="gemini-3.1-flash-lite-preview", label="Gemini 3.1 Flash Lite", provider="gemini"),
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
                contents.append(types.Content(role=role, parts=[types.Part(text=msg.text)]))
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
        return EmbeddingResult(vectors=vectors, model=model, provider=self.name, dimensions=dims)

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
        return json.loads(response.text or "[]")
