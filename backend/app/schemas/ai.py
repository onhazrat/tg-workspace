"""Response models for the AI endpoints.

Part of B6 in `docs/architecture-simplification-plan.md`.

This module is deliberately small, because **most of it already existed**.
`app/ai/models.py` declares `CompletionResult`, `EmbeddingResult` and
`ModelInfo` as real Pydantic models, and the routes were calling `.model_dump()`
on them purely to satisfy a `-> dict[str, Any]` annotation — throwing away the
type on the way out and rendering the endpoint as
`{"additionalProperties": true}`. Returning the model directly is both simpler
and correctly typed, so `/ai/summary` and `/ai/embeddings` gained a schema by
*deleting* code rather than adding any.

Only the two genuinely-new wrapper shapes are declared here.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.ai.models import ModelInfo


class ModelListResponse(BaseModel):
    """Every model the configured providers expose, plus the current default.

    `default` is shipped alongside rather than flagged on an entry so a caller
    can render the selector without scanning the list — and so a default that is
    no longer offered still round-trips instead of silently vanishing.
    """

    models: list[ModelInfo] = Field(default_factory=list)
    default: str = ""


class PromptResponse(BaseModel):
    """The assembled prompt, for the "show me what you would send" surfaces.

    Shared by `/ai/summary/prompt` and `/ai/tag/prompt`: both assemble a prompt
    and neither runs a model, so they have one shape between them.
    """

    prompt: str = ""


class TranslateResponse(BaseModel):
    """Translated posts, in the order they were submitted.

    Entries stay `dict[str, str]` because the provider contract is a bare
    `{id: text}`-shaped mapping chosen by the caller, not a fixed record.
    """

    translations: list[dict[str, str]] = Field(default_factory=list)
