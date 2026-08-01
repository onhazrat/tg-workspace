"""Post embeddings and translations — the corpus-level artefacts.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, SessionDep
from app.schemas.vectors import PostTranslationResponse, VectorWriteResponse
from app.services.data_vectors import (
    DEFAULT_VECTOR_PAGE_SIZE,
    MAX_VECTOR_PAGE_SIZE,
)
from app.services.data_vectors import (
    get_translation as get_translation_impl,
)
from app.services.data_vectors import (
    list_translations as list_translations_impl,
)
from app.services.data_vectors import (
    upsert_embeddings as upsert_embeddings_impl,
)
from app.services.data_vectors import (
    upsert_translations as upsert_translations_impl,
)

router = APIRouter()


@router.post("/embeddings")
def upsert_embeddings(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> VectorWriteResponse:
    return VectorWriteResponse.model_validate(upsert_embeddings_impl(session, body))


@router.get("/translations/one")
def get_translation(
    session: SessionDep,
    _current_user: CurrentUser,
    channel_name: str = Query(alias="channelName"),
    post_id: int = Query(alias="postId"),
    language: str = Query(),
) -> dict[str, Any] | None:
    """Read a single translation. Returns null when absent."""
    return get_translation_impl(
        session, channel_name=channel_name, post_id=post_id, language=language
    )


@router.get("/translations")
def list_translations(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_VECTOR_PAGE_SIZE, ge=1, le=MAX_VECTOR_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[PostTranslationResponse]:
    return [
        PostTranslationResponse.model_validate(row)
        for row in list_translations_impl(session, limit=limit, offset=offset)
    ]


@router.post("/translations")
def upsert_translations(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> VectorWriteResponse:
    return VectorWriteResponse.model_validate(upsert_translations_impl(session, body))
