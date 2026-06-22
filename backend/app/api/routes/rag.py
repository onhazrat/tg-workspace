"""Server-side vector search and embedding backfill."""

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import col, select

from app.ai.registry import get_provider
from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.models_tg import Post, PostEmbedding
from app.services.channels import channel_names_for_operator
from app.services.embeddings import backfill_embeddings, get_embedding_status
from app.services.serialization import post_to_camel

router = APIRouter(prefix="/rag", tags=["rag"])


class RagSearchRequest(BaseModel):
    query: str
    channels: list[str] | None = None
    start_date: int | None = Field(None, alias="startDate")
    end_date: int | None = Field(None, alias="endDate")
    limit: int = settings.RAG_SEARCH_LIMIT_DEFAULT
    scan_limit: int = Field(settings.RAG_SCAN_LIMIT_MAX, alias="scanLimit")

    model_config = {"populate_by_name": True}


class RagEmbedRequest(BaseModel):
    limit: int = settings.RAG_EMBED_LIMIT_DEFAULT


def _cosine(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=float)
    vb = np.array(b, dtype=float)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def _effective_operator_channels(
    session: SessionDep,
    current_user: CurrentUser,
    requested: list[str] | None,
) -> set[str]:
    operator_channels = channel_names_for_operator(session, current_user.id)
    if requested:
        return operator_channels.intersection(requested)
    return operator_channels


@router.get("/status")
def rag_status(session: SessionDep, current_user: CurrentUser) -> dict[str, Any]:
    operator_channels = channel_names_for_operator(session, current_user.id)
    return get_embedding_status(session, channel_names=operator_channels)


@router.post("/embed")
async def rag_embed(
    body: RagEmbedRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    try:
        return await backfill_embeddings(
            session, limit=body.limit, operator_id=current_user.id
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/search")
async def rag_search(
    body: RagSearchRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    provider = get_provider("gemini")
    try:
        query_vec = (
            await provider.embed([body.query], model=settings.EMBEDDING_MODEL)
        ).vectors[0]
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    allowed_channels = _effective_operator_channels(
        session, current_user, body.channels
    )
    if not allowed_channels:
        return {"results": []}

    scan_cap = min(max(body.scan_limit, 1), settings.RAG_SCAN_LIMIT_MAX)
    stmt = (
        select(PostEmbedding)
        .where(col(PostEmbedding.channel_name).in_(allowed_channels))
        .limit(scan_cap)
    )
    embeddings = session.exec(stmt).all()

    scored: list[tuple[float, PostEmbedding, Post | None]] = []
    for emb in embeddings:
        post = session.exec(
            select(Post).where(
                Post.channel_name == emb.channel_name,
                Post.post_id == emb.post_id,
            )
        ).first()
        if post:
            if body.start_date is not None and post.timestamp < body.start_date:
                continue
            if body.end_date is not None and post.timestamp > body.end_date:
                continue
        score = _cosine(query_vec, emb.vector)
        scored.append((score, emb, post))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[: body.limit]

    results = []
    for score, emb, post in top:
        results.append(
            {
                "score": score,
                "channelName": emb.channel_name,
                "postId": emb.post_id,
                "text": emb.text,
                "post": post_to_camel(post) if post else None,
            }
        )
    return {"results": results}
