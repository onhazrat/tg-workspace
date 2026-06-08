"""Server-side vector search."""

import math
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.ai.registry import get_provider
from app.api.deps import get_db
from app.core.config import settings
from app.models_tg import Post, PostEmbedding

router = APIRouter(prefix="/rag", tags=["rag"])


class RagSearchRequest(BaseModel):
    query: str
    channels: list[str] | None = None
    start_date: int | None = Field(None, alias="startDate")
    end_date: int | None = Field(None, alias="endDate")
    limit: int = 20

    model_config = {"populate_by_name": True}


def _cosine(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=float)
    vb = np.array(b, dtype=float)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)


@router.post("/search")
async def rag_search(body: RagSearchRequest, session: Session = Depends(get_db)) -> dict[str, Any]:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    provider = get_provider("gemini")
    try:
        query_vec = (await provider.embed([body.query], model=settings.EMBEDDING_MODEL)).vectors[0]
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    stmt = select(PostEmbedding)
    embeddings = session.exec(stmt).all()
    scored: list[tuple[float, PostEmbedding]] = []
    for emb in embeddings:
        if body.channels and emb.channel_name not in body.channels:
            continue
        score = _cosine(query_vec, emb.vector)
        scored.append((score, emb))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[: body.limit]

    results = []
    for score, emb in top:
        post = session.exec(
            select(Post).where(
                Post.channel_name == emb.channel_name,
                Post.post_id == emb.post_id,
            )
        ).first()
        if post:
            if body.start_date and post.timestamp < body.start_date:
                continue
            if body.end_date and post.timestamp > body.end_date:
                continue
        results.append(
            {
                "score": score,
                "channelName": emb.channel_name,
                "postId": emb.post_id,
                "text": emb.text,
                "post": {
                    "id": emb.post_id,
                    "channelName": emb.channel_name,
                    "text": post.text if post else emb.text,
                    "date": post.date if post else "",
                    "timestamp": post.timestamp if post else 0,
                }
                if post
                else None,
            }
        )
    return {"results": results}
