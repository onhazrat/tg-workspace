"""Server-side vector search and embedding backfill."""

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import select

from app.ai.registry import get_provider
from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.models_tg import Post, PostEmbedding
from app.services.embeddings import backfill_embeddings, get_embedding_status

router = APIRouter(prefix="/rag", tags=["rag"])


class RagSearchRequest(BaseModel):
    query: str
    channels: list[str] | None = None
    start_date: int | None = Field(None, alias="startDate")
    end_date: int | None = Field(None, alias="endDate")
    limit: int = 20

    model_config = {"populate_by_name": True}


class RagEmbedRequest(BaseModel):
    limit: int = 100


def _cosine(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=float)
    vb = np.array(b, dtype=float)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def _post_to_camel(post: Post) -> dict[str, Any]:
    return {
        "id": post.post_id,
        "channelName": post.channel_name,
        "text": post.text,
        "date": post.date,
        "timestamp": post.timestamp,
        "forwardedFrom": post.forwarded_from,
        "forwardedFromName": post.forwarded_from_name,
    }


@router.get("/status")
def rag_status(session: SessionDep, _current_user: CurrentUser) -> dict[str, Any]:
    return get_embedding_status(session)


@router.post("/embed")
async def rag_embed(
    body: RagEmbedRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    try:
        return await backfill_embeddings(session, limit=body.limit)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/search")
async def rag_search(
    body: RagSearchRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    provider = get_provider("gemini")
    try:
        query_vec = (await provider.embed([body.query], model=settings.EMBEDDING_MODEL)).vectors[0]
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    stmt = select(PostEmbedding)
    embeddings = session.exec(stmt).all()
    scored: list[tuple[float, PostEmbedding, Post | None]] = []
    for emb in embeddings:
        if body.channels and emb.channel_name not in body.channels:
            continue
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
                "post": _post_to_camel(post) if post else None,
            }
        )
    return {"results": results}
