import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.ai.base import LLMProvider
from app.ai.models import (
    ChatRequest,
    CompletionResult,
    EmbeddingResult,
    EmbedRequest,
    ModelInfo,
    ModelListRequest,
    PromptScopeInput,
    SummaryRequest,
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
from app.prompts.summary import format_summary_prompt, rtl_instruction
from app.prompts.tagging import format_tag_prompt
from app.prompts.templates import CHAT_PROMPT, RAG_CHAT_PROMPT
from app.schemas.ai import (
    ModelListResponse,
    PromptResponse,
    TranslateResponse,
)
from app.services.ai_keys import (
    AI_KEY_REJECTED_DETAIL,
    Purpose,
    ResolvedKey,
    record_validation,
    resolve_ai_key,
)
from app.services.prompt_assembly import (
    PromptScope,
    assemble_posts_text,
    assemble_tag_posts_text,
)

router = APIRouter(prefix="/ai", tags=["ai"])


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


def _resolve_posts_text(
    session: Session,
    *,
    user_id: uuid.UUID,
    channels: list[str],
    posts_text: str,
    scope: PromptScopeInput | None,
    tag_format: bool = False,
) -> str:
    """Prompt posts block: an explicit client-built ``postsText`` wins (the
    semantic/related path, which the server cannot reproduce); otherwise the
    backend resolves the scope itself. Tag prompts use the channel-grouped
    chronological format, summary/chat the flat one.

    Background regeneration used to be in the first group too. It is not any
    more — it applies no filters beyond the channels and the shifted window, so
    it is fully expressible as a scope and now sends one (A1b, pinned by
    ``tests/api/test_autoregen_scope_parity.py``)."""
    if posts_text:
        return posts_text
    if scope is None:
        return ""
    prompt_scope = PromptScope(
        channels=channels,
        start_date=scope.start_date,
        end_date=scope.end_date,
        keyword=scope.keyword,
        forwarded=scope.forwarded,
        media=scope.media,
        max_per_channel=scope.max_per_channel,
        max_per_channel_mode=scope.max_per_channel_mode,
        sort=scope.sort,
        seed=scope.seed,
    )
    if tag_format:
        return assemble_tag_posts_text(session, prompt_scope, user_id=user_id)
    return assemble_posts_text(session, prompt_scope, user_id=user_id)


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


@router.post("/summary")
async def api_summary(
    body: SummaryRequest, session: SessionDep, current_user: CurrentUser
) -> CompletionResult:
    model = body.model or default_model()
    provider, ai_key = _provider_for(
        session,
        user_id=current_user.id,
        purpose=Purpose.SUMMARY,
        key_id=body.ai_key_id,
    )
    prompt = format_summary_prompt(
        channels=body.channels,
        channels_text=body.channels_text,
        language=body.language,
        posts_text=_resolve_posts_text(
            session,
            user_id=current_user.id,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
        ),
    )
    # Returned directly: `CompletionResult` is already a Pydantic model, and
    # the old `.model_dump()` existed only to satisfy a `dict` annotation.
    try:
        return await provider.complete(
            prompt, model=model, temperature=body.temperature
        )
    except Exception as exc:
        if _note_rejection(session, ai_key, exc):
            raise HTTPException(status_code=502, detail=AI_KEY_REJECTED_DETAIL) from exc
        raise


@router.post("/summary/prompt")
def api_summary_prompt(
    body: SummaryRequest, session: SessionDep, current_user: CurrentUser
) -> PromptResponse:
    prompt = format_summary_prompt(
        channels=body.channels,
        channels_text=body.channels_text,
        language=body.language,
        posts_text=_resolve_posts_text(
            session,
            user_id=current_user.id,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
        ),
    )
    return PromptResponse(prompt=prompt)


@router.post("/summary/stream")
async def api_summary_stream(
    body: SummaryRequest, session: SessionDep, current_user: CurrentUser
) -> StreamingResponse:
    model = body.model or default_model()
    provider, ai_key = _provider_for(
        session,
        user_id=current_user.id,
        purpose=Purpose.SUMMARY,
        key_id=body.ai_key_id,
    )
    prompt = format_summary_prompt(
        channels=body.channels,
        channels_text=body.channels_text,
        language=body.language,
        posts_text=_resolve_posts_text(
            session,
            user_id=current_user.id,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
        ),
    )

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in provider.stream(
                prompt, model=model, temperature=body.temperature
            ):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as exc:
            # Note the rejection, then let it propagate either way. Swallowing
            # it fell through to the `[DONE]` below, which `sseTextStream`
            # reads as a *clean* end — so a revoked key rendered an empty
            # summary with no error anywhere, and a key revoked mid-run
            # presented partial output as a finished Artifact.
            _note_rejection(session, ai_key, exc)
            raise
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/chat/stream")
async def api_chat_stream(
    body: ChatRequest, session: SessionDep, current_user: CurrentUser
) -> StreamingResponse:
    model = body.model or default_model()
    provider, ai_key = _provider_for(
        session,
        user_id=current_user.id,
        purpose=Purpose.CHAT,
        key_id=body.ai_key_id,
    )
    template = RAG_CHAT_PROMPT if body.rag_mode else CHAT_PROMPT
    system = template.format(
        channels=(body.channels_text or "").strip() or ", ".join(body.channels),
        language=body.language,
        rtl_instruction=rtl_instruction(body.language),
        posts_text=_resolve_posts_text(
            session,
            user_id=current_user.id,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
        ),
    )

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in provider.stream(
                body.message,
                model=model,
                temperature=body.temperature,
                system_instruction=system,
                history=body.history,
            ):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as exc:
            # Note the rejection, then let it propagate either way. Swallowing
            # it fell through to the `[DONE]` below, which `sseTextStream`
            # reads as a *clean* end — so a revoked key rendered an empty
            # summary with no error anywhere, and a key revoked mid-run
            # presented partial output as a finished Artifact.
            _note_rejection(session, ai_key, exc)
            raise
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/tag/prompt")
def api_tag_prompt(
    body: TagRequest, session: SessionDep, current_user: CurrentUser
) -> PromptResponse:
    prompt = format_tag_prompt(
        channels=body.channels,
        channels_text=body.channels_text,
        posts_text=_resolve_posts_text(
            session,
            user_id=current_user.id,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
            tag_format=True,
        ),
        all_tags=body.all_tags,
        tag_mode=body.tag_mode,
        tags_per_channel_min=body.tags_per_channel_min,
        tags_per_channel_max=body.tags_per_channel_max,
    )
    return PromptResponse(prompt=prompt)


@router.post("/tag/stream")
async def api_tag_stream(
    body: TagRequest, session: SessionDep, current_user: CurrentUser
) -> StreamingResponse:
    model = body.model or default_model()
    provider, ai_key = _provider_for(
        session,
        user_id=current_user.id,
        purpose=Purpose.TAG,
        key_id=body.ai_key_id,
    )
    prompt = format_tag_prompt(
        channels=body.channels,
        channels_text=body.channels_text,
        posts_text=_resolve_posts_text(
            session,
            user_id=current_user.id,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
            tag_format=True,
        ),
        all_tags=body.all_tags,
        tag_mode=body.tag_mode,
        tags_per_channel_min=body.tags_per_channel_min,
        tags_per_channel_max=body.tags_per_channel_max,
    )

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in provider.stream(
                prompt, model=model, temperature=body.temperature
            ):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as exc:
            # Note the rejection, then let it propagate either way. Swallowing
            # it fell through to the `[DONE]` below, which `sseTextStream`
            # reads as a *clean* end — so a revoked key rendered an empty
            # summary with no error anywhere, and a key revoked mid-run
            # presented partial output as a finished Artifact.
            _note_rejection(session, ai_key, exc)
            raise
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/embeddings")
async def api_embeddings(
    body: EmbedRequest, session: SessionDep, _current_user: CurrentUser
) -> EmbeddingResult:
    model = body.model or settings.EMBEDDING_MODEL
    provider, _ = _provider_for(session, user_id=None, purpose=Purpose.EMBED)
    # Same as `/summary`: `EmbeddingResult` is already a Pydantic model.
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
