"""Request-driven AI execution, after releasing database preparation.

Orchestrator. Prompt readers own coverage, AI Keys own payment and validation;
this module owns their ordering and the short write after a rejected Key.
"""

import json
import logging
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager

from fastapi import HTTPException
from sqlmodel import Session

from app.ai.base import LLMProvider
from app.ai.failures import failure_detail, provider_code
from app.ai.models import (
    ChatRequest,
    EmbeddingResult,
    EmbedRequest,
    ModelInfo,
    ModelListRequest,
    TagRequest,
    TranslateRequest,
)
from app.ai.registry import (
    default_model,
    get_provider,
    is_credential_rejection,
    list_models_cached,
)
from app.core.config import settings
from app.core.db import engine
from app.schemas.ai import (
    ModelListResponse,
    TranslateResponse,
)
from app.services.ai_keys import (
    AI_KEY_REJECTED_DETAIL,
    Purpose,
    ResolvedKey,
    record_validation,
    resolve_ai_key,
)
from app.services.artifact_coverage import MISSING_POSTS_KEY
from app.services.artifact_prompts import chat_system_prompt, tag_prompt

logger = logging.getLogger(__name__)


@contextmanager
def _preparation(session: Session) -> Iterator[None]:
    """Consume preparation, including authentication reads, even on refusal."""
    try:
        yield
    finally:
        session.close()


def _provider_for(
    session: Session,
    *,
    user_id: uuid.UUID | None,
    purpose: Purpose,
    key_id: str | None = None,
) -> tuple[LLMProvider, ResolvedKey]:
    """Resolve who pays, then build the client that spends it.

    Two steps rather than one function, because they answer different
    questions and only the first is a rule: `resolve_ai_key` decides *whose*
    credential this call uses, `get_provider` turns a credential into a client.
    Collapsing them would put the payment rule behind a constructor.

    The `ResolvedKey` comes back as well as the provider so a caller that gets a
    rejection can clear that Key's validation stamp; the Operator Key has no row
    to clear and says so with a `credential_id` of `None`.
    """
    key = resolve_ai_key(session, user_id=user_id, purpose=purpose, key_id=key_id)
    return (
        get_provider(provider=key.provider, api_key=key.api_key, base_url=key.base_url),
        key,
    )


def _note_rejection(key: ResolvedKey, exc: BaseException) -> bool:
    """Clear the Key's validation stamp when its Provider refused it.

    This is the only thing that ever flags a Key as broken after it was saved,
    and it is deliberately driven by a call somebody was making anyway. Nothing
    re-validates on a schedule: a job that spends people's money to find out
    whether they can still spend money is the cost BYOK exists to remove.

    Returns whether the Account Key was rejected, even if recording failed,
    so a caller can turn a raw Provider error
    into the "your key was rejected" answer rather than a bare 500. The Operator
    Key has no row and is skipped, an environment variable has no stamp to
    clear, and the Account looking at the error cannot fix it either way.
    """
    if key.credential_id is None or not is_credential_rejection(exc):
        return False
    try:
        with Session(engine) as session:
            record_validation(session, key.credential_id, valid=False)
    except Exception:
        # Never attach the database error or its Provider exception chain.
        logger.error("Could not record rejected AI key validation")
    return True


async def _sse_text(
    chunks: AsyncIterator[str],
    key: ResolvedKey,
    *,
    missing_posts: int = 0,
) -> AsyncIterator[str]:
    """Frame a Provider's text stream as SSE for `sseTextStream`.

    The first frame is the Missing Post count (ADR-038): how many of the
    Artifact's Covered Posts the prompt left out, known before any text.

    A failure ends with an `error` frame and **never** with `[DONE]`, which the
    browser reads as a clean end: swallowing the exception into `[DONE]` once
    rendered a revoked Key's empty answer as a finished Summary. Re-raising
    instead kept that rule but cut the connection, so the browser could only
    say "an unexpected error occurred" about a model that was merely busy. The
    `error` frame keeps the rule and says why.
    """
    yield f"data: {json.dumps({MISSING_POSTS_KEY: missing_posts})}\n\n"
    try:
        async for chunk in chunks:
            yield f"data: {json.dumps({'text': chunk})}\n\n"
    except Exception as exc:
        _note_rejection(key, exc)
        detail = failure_detail(exc, key)
        if provider_code(exc) is not None:
            # The Provider said no. Log the scrubbed sentence, not `exc`: the
            # raw message is what may echo the Key.
            logger.warning("AI provider stream failed: %s", detail)
        else:
            # Keep the stack for bugs, without raw messages or exception chains.
            safe = RuntimeError("Unexpected AI stream failure")
            logger.error(
                "AI stream failed unexpectedly",
                exc_info=(RuntimeError, safe, exc.__traceback__),
            )
        yield f"data: {json.dumps({'error': detail})}\n\n"
        return
    yield "data: [DONE]\n\n"


def _default_for(models: list[ModelInfo]) -> str:
    """A model id this Provider will actually accept.

    `DEFAULT_AI_MODEL` is one deployment-wide Gemini id, which was the only
    possible answer while the Operator's key paid for everything and is the
    wrong one the moment an Account's only Key is an OpenRouter or Ollama
    credential: the settings default is a Gemini id, the client renders it
    unchanged, and the first Summary posts `gemini-3-flash-preview` to an
    endpoint that has never heard of it.

    So the deployment default survives only if this Provider offers it.
    Otherwise the Provider's own first model is the honest answer. An empty
    list, a Provider serving no catalogue, keeps the deployment default,
    because there is nothing better to say and the field is free text there.
    """
    if not models:
        return default_model()
    offered = {m.id for m in models}
    return default_model() if default_model() in offered else models[0].id


async def list_models(
    body: ModelListRequest, session: Session, *, user_id: uuid.UUID
) -> ModelListResponse:
    # `resolve_ai_key` rather than `_provider_for`: the cache below builds the
    # client only on a miss, and building a second one here to throw away would
    # be the more confusing line, not the shorter one.
    with _preparation(session):
        ai_key = resolve_ai_key(
            session,
            user_id=user_id,
            purpose=Purpose.MODELS,
            key_id=body.ai_key_id,
        )
    try:
        models = await list_models_cached(
            provider=ai_key.provider,
            api_key=ai_key.api_key,
            base_url=ai_key.base_url,
            cache_key=f"{ai_key.credential_id}|{ai_key.base_url or ''}",
        )
    except Exception as exc:
        if _note_rejection(ai_key, exc):
            raise HTTPException(
                status_code=502, detail=AI_KEY_REJECTED_DETAIL
            ) from None
        # Everything else is an endpoint that serves no catalogue, or one that
        # is briefly unwell. Neither is a reason to block the Account from
        # making an Artifact: the empty list is what the client turns into a
        # free-text model id, which is the whole point of accepting Providers
        # nobody has heard of.
        models = []
    return ModelListResponse(models=models, default=_default_for(models))


def chat_stream(
    body: ChatRequest, session: Session, *, user_id: uuid.UUID
) -> AsyncIterator[str]:
    with _preparation(session):
        system, missing = chat_system_prompt(session, body, user_id=user_id)
        model = body.model or default_model()
        provider, ai_key = _provider_for(
            session, user_id=user_id, purpose=Purpose.CHAT, key_id=body.ai_key_id
        )
    chunks = provider.stream(
        body.message,
        model=model,
        temperature=body.temperature,
        system_instruction=system,
        history=body.history,
    )
    return _sse_text(chunks, ai_key, missing_posts=missing)


def tag_stream(
    body: TagRequest, session: Session, *, user_id: uuid.UUID
) -> AsyncIterator[str]:
    with _preparation(session):
        prompt, missing = tag_prompt(session, body, user_id=user_id)
        model = body.model or default_model()
        provider, ai_key = _provider_for(
            session, user_id=user_id, purpose=Purpose.TAG, key_id=body.ai_key_id
        )
    return _sse_text(
        provider.stream(prompt, model=model, temperature=body.temperature),
        ai_key,
        missing_posts=missing,
    )


async def embeddings(body: EmbedRequest, session: Session) -> EmbeddingResult:
    with _preparation(session):
        model = body.model or settings.EMBEDDING_MODEL
        provider, _ = _provider_for(session, user_id=None, purpose=Purpose.EMBED)
    return await provider.embed(body.texts, model=model)


async def translate(body: TranslateRequest, session: Session) -> TranslateResponse:
    with _preparation(session):
        model = body.model or default_model()
        provider, _ = _provider_for(session, user_id=None, purpose=Purpose.TRANSLATE)
    translations = await provider.translate_batch(
        body.posts, target_language=body.target_language, model=model
    )
    return TranslateResponse(translations=translations)
