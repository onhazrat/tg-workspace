import json
import logging
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.ai.base import LLMProvider
from app.ai.failures import failure_detail, provider_code
from app.ai.models import (
    ChatRequest,
    EmbeddingResult,
    EmbedRequest,
    ModelInfo,
    ModelListRequest,
    SummaryPromptRequest,
    TagRequest,
    TranslateRequest,
)
from app.ai.registry import (
    default_model,
    get_provider,
    is_credential_rejection,
    list_models_cached,
)
from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.jobs.summary_generation import summary_prompt
from app.models_tg import ChatSessionPayload, SummaryPayload
from app.prompts.summary import rtl_instruction
from app.prompts.tagging import format_tag_prompt
from app.prompts.templates import CHAT_PROMPT, RAG_CHAT_PROMPT
from app.schemas.ai import (
    ModelListResponse,
    PromptResponse,
    TranslateResponse,
)
from app.schemas.scope import FrozenScope
from app.services.ai_keys import (
    AI_KEY_REJECTED_DETAIL,
    Purpose,
    ResolvedKey,
    record_validation,
    resolve_ai_key,
)
from app.services.artifact_coverage import Layout, posts_block
from app.services.chat_sessions import frozen_scope_of as chat_scope
from app.services.chat_sessions import own_chat_session
from app.services.summaries import own_summary
from app.services.tag_runs import frozen_scope_of as tag_run_scope
from app.services.tag_runs import own_tag_run

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)

_NO_SCOPE_DETAIL = "This Artifact records no Scope, so no prompt can be built."


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


def _note_rejection(session: Session, key: ResolvedKey, exc: BaseException) -> bool:
    """Clear the Key's validation stamp when its Provider refused it.

    This is the only thing that ever flags a Key as broken after it was saved,
    and it is deliberately driven by a call somebody was making anyway. Nothing
    re-validates on a schedule: a job that spends people's money to find out
    whether they can still spend money is the cost BYOK exists to remove.

    Returns whether it did anything, so a caller can turn a raw Provider error
    into the "your key was rejected" answer rather than a bare 500. The Operator
    Key has no row and is skipped — an environment variable has no stamp to
    clear, and the Account looking at the error cannot fix it either way.
    """
    if key.credential_id is None or not is_credential_rejection(exc):
        return False
    record_validation(session, key.credential_id, valid=False)
    return True


async def _sse_text(
    chunks: AsyncIterator[str],
    session: Session,
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
    yield f"data: {json.dumps({'missingPosts': missing_posts})}\n\n"
    try:
        async for chunk in chunks:
            yield f"data: {json.dumps({'text': chunk})}\n\n"
    except Exception as exc:
        _note_rejection(session, key, exc)
        detail = failure_detail(exc, key)
        if provider_code(exc) is not None:
            # The Provider said no. Log the scrubbed sentence, not `exc`: the
            # raw message is what may echo the Key.
            logger.warning("AI provider stream failed: %s", detail)
        else:
            # Nothing answered with a status, so this may be a bug here, and
            # the traceback is what finds it. Keys travel in headers, never in
            # URLs or messages this process builds.
            logger.error("AI stream failed unexpectedly", exc_info=exc)
        yield f"data: {json.dumps({'error': detail})}\n\n"
        return
    yield "data: [DONE]\n\n"


def _covered(
    session: Session,
    scope: FrozenScope | None,
    *,
    user_id: uuid.UUID,
    layout: Layout,
) -> tuple[list[str], str, int]:
    """An Artifact's Channels, its posts block, and its Missing Post count.

    Read from what the Artifact froze, never from the request (ADR-038). An
    Artifact opened before AW-06 records no Scope, so no prompt can be built.
    """
    if scope is None:
        raise HTTPException(status_code=422, detail=_NO_SCOPE_DETAIL)
    text, coverage = posts_block(session, scope, user_id=user_id, layout=layout)
    return list(scope.channels), text, coverage.missing


def _tag_prompt(
    session: Session, body: TagRequest, user_id: uuid.UUID
) -> tuple[str, int]:
    """A Tag run's prompt from its Covered Posts, and how many were missing."""
    run = own_tag_run(session, body.tag_run_id, user_id=user_id)
    channels, posts_text, missing = _covered(
        session, tag_run_scope(run), user_id=user_id, layout="tag"
    )
    prompt = format_tag_prompt(
        channels=channels,
        channels_text=body.channels_text,
        posts_text=posts_text,
        all_tags=body.all_tags,
        tag_mode=body.tag_mode,
        tags_per_channel_min=body.tags_per_channel_min,
        tags_per_channel_max=body.tags_per_channel_max,
    )
    return prompt, missing


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
    list — a Provider serving no catalogue — keeps the deployment default,
    because there is nothing better to say and the field is free text there.
    """
    if not models:
        return default_model()
    offered = {m.id for m in models}
    return default_model() if default_model() in offered else models[0].id


# POST, and deliberately not on `VIEW_AS_READ_ONLY_PATHS`. This used to serve a
# static list and was a read; it now asks an Account's own Provider what it
# offers, which is an authenticated outbound call made on their behalf. The bar
# `deps.py` states for that allowlist — reads a row, writes none, reaches no
# external service, spends no Budget — already refuses `POST /rag/search` on the
# third clause, and refuses this on the same one.
#
# In a comment rather than a docstring: a handler docstring becomes the
# `openapi.json` description and a JSDoc block in the generated client.
@router.post("/models")
async def api_list_models(
    body: ModelListRequest, session: SessionDep, current_user: CurrentUser
) -> ModelListResponse:
    """List the models the chosen AI key's provider offers."""
    # `resolve_ai_key` rather than `_provider_for`: the cache below builds the
    # client only on a miss, and building a second one here to throw away would
    # be the more confusing line, not the shorter one.
    ai_key = resolve_ai_key(
        session,
        user_id=current_user.id,
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
        if _note_rejection(session, ai_key, exc):
            raise HTTPException(status_code=502, detail=AI_KEY_REJECTED_DETAIL) from exc
        # Everything else is an endpoint that serves no catalogue, or one that
        # is briefly unwell. Neither is a reason to block the Account from
        # making an Artifact: the empty list is what the client turns into a
        # free-text model id, which is the whole point of accepting Providers
        # nobody has heard of.
        models = []
    return ModelListResponse(models=models, default=_default_for(models))


# The Summary named, never a Scope: the prompt reads its Covered Posts, the
# same prompt Generate stores (ADR-038). A foreign or absent id is the
# family's 404.
@router.post("/summary/prompt")
def api_summary_prompt(
    body: SummaryPromptRequest, session: SessionDep, current_user: CurrentUser
) -> PromptResponse:
    summary = own_summary(
        session, body.summary_id, user_id=current_user.id, writing=False
    )
    prompt, coverage = summary_prompt(
        session,
        summary,
        session.get(SummaryPayload, summary.id),
        channels_text=body.channels_text,
    )
    return PromptResponse(prompt=prompt, missingPosts=coverage.missing)


# The Chat named, never a Scope: each turn reads the Chat's Covered Posts, so
# changing the Posts tab leaves an open Chat about the Posts it started from
# (ADR-038). Semantic mode's ranked `postsText` still wins. The Artifact is read
# before a Key is resolved, so a foreign id is the family's 404 and spends
# nothing.
@router.post("/chat/stream")
async def api_chat_stream(
    body: ChatRequest, session: SessionDep, current_user: CurrentUser
) -> StreamingResponse:
    chat = own_chat_session(session, body.chat_id, user_id=current_user.id)
    channels: list[str] = []
    if body.posts_text:
        posts_text, missing = body.posts_text, 0
    else:
        channels, posts_text, missing = _covered(
            session,
            chat_scope(chat, session.get(ChatSessionPayload, chat.id)),
            user_id=current_user.id,
            layout="flat",
        )
    model = body.model or default_model()
    provider, ai_key = _provider_for(
        session,
        user_id=current_user.id,
        purpose=Purpose.CHAT,
        key_id=body.ai_key_id,
    )
    template = RAG_CHAT_PROMPT if body.rag_mode else CHAT_PROMPT
    system = template.format(
        channels=body.channels_text.strip() or ", ".join(channels),
        language=body.language,
        rtl_instruction=rtl_instruction(body.language),
        posts_text=posts_text,
    )

    chunks = provider.stream(
        body.message,
        model=model,
        temperature=body.temperature,
        system_instruction=system,
        history=body.history,
    )
    return StreamingResponse(
        _sse_text(chunks, session, ai_key, missing_posts=missing),
        media_type="text/event-stream",
    )


# The Tag run named, never a Scope: the prompt reads its Covered Posts by
# Channel (ADR-038). A foreign or absent id is the family's 404.
@router.post("/tag/prompt")
def api_tag_prompt(
    body: TagRequest, session: SessionDep, current_user: CurrentUser
) -> PromptResponse:
    prompt, missing = _tag_prompt(session, body, current_user.id)
    return PromptResponse(prompt=prompt, missingPosts=missing)


@router.post("/tag/stream")
async def api_tag_stream(
    body: TagRequest, session: SessionDep, current_user: CurrentUser
) -> StreamingResponse:
    prompt, missing = _tag_prompt(session, body, current_user.id)
    model = body.model or default_model()
    provider, ai_key = _provider_for(
        session,
        user_id=current_user.id,
        purpose=Purpose.TAG,
        key_id=body.ai_key_id,
    )
    return StreamingResponse(
        _sse_text(
            provider.stream(prompt, model=model, temperature=body.temperature),
            session,
            ai_key,
            missing_posts=missing,
        ),
        media_type="text/event-stream",
    )


@router.post("/embeddings")
async def api_embeddings(
    body: EmbedRequest, session: SessionDep, _current_user: CurrentUser
) -> EmbeddingResult:
    model = body.model or settings.EMBEDDING_MODEL
    provider, _ = _provider_for(session, user_id=None, purpose=Purpose.EMBED)
    # `EmbeddingResult` is already a Pydantic model.
    return await provider.embed(body.texts, model=model)


@router.post("/translate")
async def api_translate(
    body: TranslateRequest, session: SessionDep, _current_user: CurrentUser
) -> TranslateResponse:
    model = body.model or default_model()
    provider, _ = _provider_for(session, user_id=None, purpose=Purpose.TRANSLATE)
    translations = await provider.translate_batch(
        body.posts, target_language=body.target_language, model=model
    )
    return TranslateResponse(translations=translations)
