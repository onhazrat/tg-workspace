import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.ai.models import (
    ChatRequest,
    EmbedRequest,
    PromptScopeInput,
    SummaryRequest,
    TagRequest,
    TranslateRequest,
)
from app.ai.registry import default_model, get_provider, list_all_models
from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.prompts.summary import format_summary_prompt, rtl_instruction
from app.prompts.tagging import format_tag_prompt
from app.prompts.templates import CHAT_PROMPT, RAG_CHAT_PROMPT
from app.services.prompt_assembly import PromptScope, assemble_posts_text

router = APIRouter(prefix="/ai", tags=["ai"])


def _resolve_posts_text(
    session: Session,
    *,
    channels: list[str],
    posts_text: str,
    scope: PromptScopeInput | None,
) -> str:
    """Prompt posts block: an explicit client-built ``postsText`` wins (the
    semantic/related path and background regeneration, which the server cannot
    reproduce); otherwise the backend resolves the scope itself."""
    if posts_text:
        return posts_text
    if scope is None:
        return ""
    return assemble_posts_text(
        session,
        PromptScope(
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
        ),
    )


@router.get("/models")
def api_list_models(_current_user: CurrentUser) -> dict[str, Any]:
    return {"models": list_all_models(), "default": default_model()}


@router.post("/summary")
async def api_summary(
    body: SummaryRequest, session: SessionDep, _current_user: CurrentUser
) -> dict[str, Any]:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    model = body.model or default_model()
    provider = get_provider(body.provider)
    prompt = format_summary_prompt(
        channels=body.channels,
        channels_text=body.channels_text,
        language=body.language,
        posts_text=_resolve_posts_text(
            session,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
        ),
    )
    result = await provider.complete(prompt, model=model, temperature=body.temperature)
    return result.model_dump()


@router.post("/summary/prompt")
def api_summary_prompt(
    body: SummaryRequest, session: SessionDep, _current_user: CurrentUser
) -> dict[str, Any]:
    prompt = format_summary_prompt(
        channels=body.channels,
        channels_text=body.channels_text,
        language=body.language,
        posts_text=_resolve_posts_text(
            session,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
        ),
    )
    return {"prompt": prompt}


@router.post("/summary/stream")
async def api_summary_stream(
    body: SummaryRequest, session: SessionDep, _current_user: CurrentUser
) -> StreamingResponse:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    model = body.model or default_model()
    provider = get_provider(body.provider)
    prompt = format_summary_prompt(
        channels=body.channels,
        channels_text=body.channels_text,
        language=body.language,
        posts_text=_resolve_posts_text(
            session,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
        ),
    )

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in provider.stream(
            prompt, model=model, temperature=body.temperature
        ):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/chat/stream")
async def api_chat_stream(
    body: ChatRequest, session: SessionDep, _current_user: CurrentUser
) -> StreamingResponse:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    model = body.model or default_model()
    provider = get_provider(body.provider)
    template = RAG_CHAT_PROMPT if body.rag_mode else CHAT_PROMPT
    system = template.format(
        channels=(body.channels_text or "").strip() or ", ".join(body.channels),
        language=body.language,
        rtl_instruction=rtl_instruction(body.language),
        posts_text=_resolve_posts_text(
            session,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
        ),
    )

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in provider.stream(
            body.message,
            model=model,
            temperature=body.temperature,
            system_instruction=system,
            history=body.history,
        ):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/tag/prompt")
def api_tag_prompt(
    body: TagRequest, session: SessionDep, _current_user: CurrentUser
) -> dict[str, str]:
    prompt = format_tag_prompt(
        channels=body.channels,
        channels_text=body.channels_text,
        posts_text=_resolve_posts_text(
            session,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
        ),
        all_tags=body.all_tags,
        tag_mode=body.tag_mode,
        tags_per_channel_min=body.tags_per_channel_min,
        tags_per_channel_max=body.tags_per_channel_max,
    )
    return {"prompt": prompt}


@router.post("/tag/stream")
async def api_tag_stream(
    body: TagRequest, session: SessionDep, _current_user: CurrentUser
) -> StreamingResponse:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    model = body.model or default_model()
    provider = get_provider(body.provider)
    prompt = format_tag_prompt(
        channels=body.channels,
        channels_text=body.channels_text,
        posts_text=_resolve_posts_text(
            session,
            channels=body.channels,
            posts_text=body.posts_text,
            scope=body.scope,
        ),
        all_tags=body.all_tags,
        tag_mode=body.tag_mode,
        tags_per_channel_min=body.tags_per_channel_min,
        tags_per_channel_max=body.tags_per_channel_max,
    )

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in provider.stream(
            prompt, model=model, temperature=body.temperature
        ):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/embeddings")
async def api_embeddings(
    body: EmbedRequest, _current_user: CurrentUser
) -> dict[str, Any]:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    model = body.model or settings.EMBEDDING_MODEL
    provider = get_provider(body.provider)
    result = await provider.embed(body.texts, model=model)
    return result.model_dump()


@router.post("/translate")
async def api_translate(
    body: TranslateRequest, _current_user: CurrentUser
) -> dict[str, Any]:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    model = body.model or default_model()
    provider = get_provider(body.provider)
    translations = await provider.translate_batch(
        body.posts, target_language=body.target_language, model=model
    )
    return {"translations": translations}
