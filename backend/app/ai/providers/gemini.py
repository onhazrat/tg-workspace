from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import cast

from google import genai
from google.genai import types

from app.ai.models import ChatMessage, CompletionResult, EmbeddingResult, ModelInfo

RTL_LANGUAGES = {"Persian", "Arabic", "فارسی", "العربية"}


def rtl_instruction(language: str) -> str:
    """The RTL directive for a *translation*, shared by both Providers.

    Public, and deliberately not `prompts/summary.rtl_instruction`, which says
    "the entire summary" and is wrong for a batch of post translations. It
    stays here rather than moving to a third module because this is where it
    has always lived and one importer does not make a package — but it is no
    longer private, because `openai_compatible.py` needs the same words and a
    reworded copy there is the twin divergence CLAUDE.md warns about.
    """
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

    async def list_models(self) -> list[ModelInfo]:
        """What this credential can actually reach, asked of Google.

        This was three ids hardcoded here and hardcoded again in
        `frontend/src/constants.ts`; BYOK-02 deleted both. A static list ages
        without anybody noticing, and it cannot be right for two Accounts on
        different Google projects, which do not see the same set.

        Filtered to the models that can answer a prompt: `models.list()` also
        returns embedding-only and tuned entries, and offering one of those in a
        summary dropdown produces a failure at Artifact time with nothing on
        screen to explain it.
        """
        models: list[ModelInfo] = []
        async for entry in await self._get_client().aio.models.list():
            name = (entry.name or "").removeprefix("models/")
            actions = entry.supported_actions
            if not name or (actions is not None and "generateContent" not in actions):
                continue
            models.append(
                ModelInfo(id=name, label=entry.display_name or name, provider=self.name)
            )
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
        rtl = rtl_instruction(target_language)
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
