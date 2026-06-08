import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.ai.models import ChatRequest, EmbedRequest, SummaryRequest, TranslateRequest
from app.api.deps import CurrentUser
from app.ai.registry import default_model, get_provider, list_all_models
from app.core.config import settings
from app.prompts.templates import CHAT_PROMPT, RAG_CHAT_PROMPT, SYSTEM_PROMPT

router = APIRouter(prefix="/ai", tags=["ai"])

RTL_LANGUAGES = {"Persian", "Arabic", "فارسی", "العربية"}


def _rtl(language: str) -> str:
    if language in RTL_LANGUAGES:
        return (
            "IMPORTANT: Since this is a Right-to-Left (RTL) language, ensure the entire "
            "summary is formatted correctly for RTL reading."
        )
    return ""


@router.get("/models")
def api_list_models(_current_user: CurrentUser) -> dict:
    return {"models": list_all_models(), "default": default_model()}


@router.post("/summary")
async def api_summary(body: SummaryRequest, _current_user: CurrentUser) -> dict:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    model = body.model or default_model()
    provider = get_provider(body.provider)
    prompt = SYSTEM_PROMPT.format(
        channels=", ".join(body.channels),
        language=body.language,
        rtl_instruction=_rtl(body.language),
        posts_text=body.posts_text,
    )
    result = await provider.complete(prompt, model=model, temperature=body.temperature)
    return result.model_dump()


@router.post("/summary/stream")
async def api_summary_stream(
    body: SummaryRequest, _current_user: CurrentUser
) -> StreamingResponse:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    model = body.model or default_model()
    provider = get_provider(body.provider)
    prompt = SYSTEM_PROMPT.format(
        channels=", ".join(body.channels),
        language=body.language,
        rtl_instruction=_rtl(body.language),
        posts_text=body.posts_text,
    )

    async def event_stream() -> AsyncIterator[str]:
        async for chunk in provider.stream(prompt, model=model, temperature=body.temperature):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/chat/stream")
async def api_chat_stream(body: ChatRequest, _current_user: CurrentUser) -> StreamingResponse:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    model = body.model or default_model()
    provider = get_provider(body.provider)
    template = RAG_CHAT_PROMPT if body.rag_mode else CHAT_PROMPT
    system = template.format(
        channels=", ".join(body.channels),
        language=body.language,
        rtl_instruction=_rtl(body.language),
        posts_text=body.posts_text,
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


@router.post("/embeddings")
async def api_embeddings(body: EmbedRequest, _current_user: CurrentUser) -> dict:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    model = body.model or settings.EMBEDDING_MODEL
    provider = get_provider(body.provider)
    result = await provider.embed(body.texts, model=model)
    return result.model_dump()


@router.post("/translate")
async def api_translate(body: TranslateRequest, _current_user: CurrentUser) -> dict:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    model = body.model or default_model()
    provider = get_provider(body.provider)
    translations = await provider.translate_batch(
        body.posts, target_language=body.target_language, model=model
    )
    return {"translations": translations}
