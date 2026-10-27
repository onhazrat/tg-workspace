from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.ai.models import (
    ChatRequest,
    EmbeddingResult,
    EmbedRequest,
    ModelListRequest,
    SummaryPromptRequest,
    TagRequest,
    TranslateRequest,
)
from app.api.deps import CurrentUser, SessionDep
from app.models_tg import SummaryPayload
from app.schemas.ai import ModelListResponse, PromptResponse, TranslateResponse
from app.services import ai_execution
from app.services.artifact_prompts import summary_prompt, tag_prompt
from app.services.summaries import own_summary

router = APIRouter(prefix="/ai", tags=["ai"])


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
    return await ai_execution.list_models(body, session, user_id=current_user.id)


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
        session, summary, session.get(SummaryPayload, summary.id)
    )
    return PromptResponse(prompt=prompt, missing_posts=coverage.missing)


# The Chat named, never a Scope: each turn reads the Chat's Covered Posts, so
# changing the Posts tab leaves an open Chat about the Posts it started from
# (ADR-038). Semantic mode's ranked `postsText` still wins. The Artifact is read
# before a Key is resolved, so a foreign id is the family's 404 and spends
# nothing.
@router.post("/chat/stream")
async def api_chat_stream(
    body: ChatRequest, session: SessionDep, current_user: CurrentUser
) -> StreamingResponse:
    return StreamingResponse(
        ai_execution.chat_stream(body, session, user_id=current_user.id),
        media_type="text/event-stream",
    )


# The Tag run named, never a Scope: the prompt reads its Covered Posts by
# Channel (ADR-038). A foreign or absent id is the family's 404.
@router.post("/tag/prompt")
def api_tag_prompt(
    body: TagRequest, session: SessionDep, current_user: CurrentUser
) -> PromptResponse:
    prompt, missing = tag_prompt(session, body, user_id=current_user.id)
    return PromptResponse(prompt=prompt, missing_posts=missing)


@router.post("/tag/stream")
async def api_tag_stream(
    body: TagRequest, session: SessionDep, current_user: CurrentUser
) -> StreamingResponse:
    return StreamingResponse(
        ai_execution.tag_stream(body, session, user_id=current_user.id),
        media_type="text/event-stream",
    )


@router.post("/embeddings")
async def api_embeddings(
    body: EmbedRequest, session: SessionDep, _current_user: CurrentUser
) -> EmbeddingResult:
    return await ai_execution.embeddings(body, session)


@router.post("/translate")
async def api_translate(
    body: TranslateRequest, session: SessionDep, _current_user: CurrentUser
) -> TranslateResponse:
    return await ai_execution.translate(body, session)
