"""Database table counts for operator (Mode A)."""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session, col, func, or_, select

from app.models_tg import (
    BotCredential,
    Channel,
    ChatDestination,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    Post,
    PostEmbedding,
    PublishLog,
    Summary,
    SyncLog,
)
from app.services.operator import get_operator_user_id


def _scoped_count(
    session: Session,
    model: type,
    operator_id: uuid.UUID | None,
) -> int:
    stmt = select(func.count()).select_from(model)  # type: ignore[arg-type]
    if operator_id is not None and hasattr(model, "user_id"):
        stmt = stmt.where(
            or_(col(model.user_id) == operator_id, col(model.user_id).is_(None))  # type: ignore[attr-defined]
        )
    return session.exec(stmt).one()


def get_db_stats(session: Session, operator_id: uuid.UUID | None = None) -> dict[str, Any]:
    if operator_id is None:
        operator_id = get_operator_user_id(session)

    embedded = session.exec(
        select(func.count()).select_from(PostEmbedding)
    ).one()

    return {
        "postCount": _scoped_count(session, Post, operator_id),
        "channelCount": _scoped_count(session, Channel, operator_id),
        "summaryCount": _scoped_count(session, Summary, operator_id),
        "embeddedPostCount": embedded,
        "botCount": _scoped_count(session, BotCredential, operator_id),
        "destinationCount": _scoped_count(session, ChatDestination, operator_id),
        "publishLogCount": _scoped_count(session, PublishLog, operator_id),
        "syncLogCount": _scoped_count(session, SyncLog, operator_id),
        "llmLogCount": _scoped_count(session, LLMLog, operator_id),
        "embeddingLogCount": _scoped_count(session, EmbeddingLog, operator_id),
        "networkLogCount": _scoped_count(session, NetworkLog, operator_id),
    }
