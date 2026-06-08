from collections.abc import AsyncIterator
from typing import Protocol

from app.ai.models import ChatMessage, CompletionResult, EmbeddingResult, ModelInfo


class LLMProvider(Protocol):
    name: str

    async def list_models(self) -> list[ModelInfo]: ...

    async def complete(
        self,
        prompt: str,
        *,
        model: str,
        temperature: float = 0.7,
        system_instruction: str | None = None,
    ) -> CompletionResult: ...

    async def stream(
        self,
        prompt: str,
        *,
        model: str,
        temperature: float = 0.7,
        system_instruction: str | None = None,
        history: list[ChatMessage] | None = None,
    ) -> AsyncIterator[str]: ...

    async def embed(self, texts: list[str], *, model: str) -> EmbeddingResult: ...

    async def translate_batch(
        self,
        items: list[dict[str, str]],
        *,
        target_language: str,
        model: str,
    ) -> list[dict[str, str]]: ...
