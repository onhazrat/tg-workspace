"""Server-side vector search and embedding backfill."""

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from sqlalchemy import and_, or_
from sqlmodel import col, select

from app.ai.registry import get_provider
from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.models_tg import Post, PostEmbedding
from app.schemas.rag import (
    RagEmbedRequest,
    RagEmbedResponse,
    RagSearchRequest,
    RagSearchResponse,
    RagStatusResponse,
)
from app.services.channels import channel_names_for_operator
from app.services.embeddings import backfill_embeddings, get_embedding_status
from app.services.serialization import post_to_camel

router = APIRouter(prefix="/rag", tags=["rag"])


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
def rag_status(session: SessionDep, current_user: CurrentUser) -> RagStatusResponse:
    operator_channels = channel_names_for_operator(session, current_user.id)
    return RagStatusResponse.model_validate(
        get_embedding_status(session, channel_names=operator_channels)
    )


@router.post("/embed")
async def rag_embed(
    body: RagEmbedRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> RagEmbedResponse:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    try:
        return RagEmbedResponse.model_validate(
            await backfill_embeddings(
                session, limit=body.limit, operator_id=current_user.id
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/search")
async def rag_search(
    body: RagSearchRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> RagSearchResponse:
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
        # Explicitly the same key set as the main path. This branch used
        # to return a bare `{"results": []}`, so callers saw `truncated`
        # and `scanned` appear and disappear depending on scope.
        return RagSearchResponse(results=[], truncated=False, scanned=0)

    scan_cap = min(max(body.scan_limit, 1), settings.RAG_SCAN_LIMIT_MAX)

    # One query, not one per embedding: this loop previously issued a SELECT
    # per embedding, up to RAG_SCAN_LIMIT_MAX (5000) round trips per search.
    #
    # The join is an outer join and the date predicate tolerates a missing
    # post, preserving the previous behaviour where an embedding whose post
    # row is absent is still scored and returned.
    date_ok: list[Any] = [col(Post.post_id).is_(None)]
    in_range: list[Any] = []
    if body.start_date is not None:
        in_range.append(col(Post.timestamp) >= body.start_date)
    if body.end_date is not None:
        in_range.append(col(Post.timestamp) <= body.end_date)
    date_ok.append(and_(*in_range) if in_range else col(Post.post_id).isnot(None))

    stmt = (
        select(PostEmbedding, Post)
        .join(
            Post,
            onclause=and_(
                col(PostEmbedding.channel_name) == col(Post.channel_name),
                col(PostEmbedding.post_id) == col(Post.post_id),
            ),
            isouter=True,
        )
        .where(col(PostEmbedding.channel_name).in_(allowed_channels))
        .where(or_(*date_ok))
        # Deterministic ordering: without it the cap below took an arbitrary
        # DB-order subset, so identical searches could return different
        # results. Newest-first also makes the scanned window the useful one.
        .order_by(
            col(Post.timestamp).desc().nullslast(),
            col(PostEmbedding.channel_name),
            col(PostEmbedding.post_id),
        )
        # One extra row is a truncation probe — cheaper than a COUNT over
        # the whole embedding table.
        .limit(scan_cap + 1)
    )
    rows = list(session.exec(stmt).all())

    truncated = len(rows) > scan_cap
    if truncated:
        rows = rows[:scan_cap]

    scored: list[tuple[float, PostEmbedding, Post | None]] = [
        (_cosine(query_vec, emb.vector), emb, post) for emb, post in rows
    ]

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
    # Surfaced so callers can tell a thin result set from a capped scan.
    # pgvector is the real fix; see docs/ideas-log.
    return RagSearchResponse.model_validate(
        {"results": results, "truncated": truncated, "scanned": len(rows)}
    )
