"""Database table counts for operator (Mode A)."""

from __future__ import annotations

import uuid
from typing import Any, cast

from sqlalchemy import delete, text
from sqlmodel import Session, col, func, or_, select

from app.models_tg import (
    BotCredential,
    Channel,
    ChannelSettingGroup,
    ChatDestination,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    Post,
    PostEmbedding,
    PostSyncState,
    PostTranslation,
    PublishLog,
    Summary,
    SummaryPayload,
    SyncLog,
    SyncLogPayload,
)


def _scoped_count(
    session: Session,
    model: type[Any],
    operator_id: uuid.UUID | None,
) -> int:
    stmt = select(func.count()).select_from(model)
    if operator_id is not None and hasattr(model, "user_id"):
        user_id_col = cast(Any, model).user_id
        stmt = stmt.where(
            or_(col(user_id_col) == operator_id, col(user_id_col).is_(None))
        )
    return session.exec(stmt).one()


def get_db_stats(session: Session, operator_id: uuid.UUID) -> dict[str, Any]:
    # `operator_id: uuid.UUID | None = None` with a `get_operator_user_id`
    # fallback until ticket 21. All three of this module's entry points are
    # called from `routes/data/admin.py` with `_current_user.id` behind an
    # authenticated dependency, so the fallback was unreachable and the default
    # only made the parameter look optional to the next caller.

    embedded = session.exec(select(func.count()).select_from(PostEmbedding)).one()

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


# Mirrors the export document's sections (data_import_export.EXPECTED_SECTIONS)
# so "table sizes" and "full export" always describe the same set of tables.
_TABLE_SECTIONS: tuple[tuple[str, type[Any]], ...] = (
    ("setting_groups", ChannelSettingGroup),
    ("channels", Channel),
    ("posts", Post),
    ("summaries", Summary),
    ("bot_credentials", BotCredential),
    ("chat_destinations", ChatDestination),
    ("publish_logs", PublishLog),
    ("sync_logs", SyncLog),
    ("llm_logs", LLMLog),
    ("embedding_logs", EmbeddingLog),
    ("network_logs", NetworkLog),
    ("embeddings", PostEmbedding),
    ("translations", PostTranslation),
)


def _table_size_bytes(session: Session, model: type[Any]) -> int:
    result = session.execute(
        text("SELECT pg_total_relation_size(CAST(:table_name AS regclass))"),
        {"table_name": model.__tablename__},
    ).scalar_one()
    return int(result)


def get_table_sizes(session: Session, operator_id: uuid.UUID) -> list[dict[str, Any]]:
    """Row count and on-disk footprint for every exportable table.

    Size is the whole physical footprint (heap + TOAST + indexes) straight
    from Postgres, not an estimate: JSON payload columns (e.g. sync log
    responses) can dwarf what row count alone suggests.
    """
    return [
        {
            "name": name,
            "count": _scoped_count(session, model, operator_id),
            "size": _table_size_bytes(session, model),
        }
        for name, model in _TABLE_SECTIONS
    ]


def _scoped_delete(
    session: Session, model: type[Any], operator_id: uuid.UUID | None
) -> int:
    stmt = delete(model)
    if operator_id is not None and hasattr(model, "user_id"):
        user_id_col = cast(Any, model).user_id
        stmt = stmt.where(
            or_(col(user_id_col) == operator_id, col(user_id_col).is_(None))
        )
    return cast(Any, session.execute(stmt)).rowcount or 0


def clear_table(session: Session, name: str, operator_id: uuid.UUID) -> int:
    """Delete every row of one exportable table, scoped to the operator.

    A bulk SQL DELETE, not a fetch-then-loop: several of these tables run
    into the millions of rows (see get_table_sizes), and materialising them
    in Python first would repeat the exact memory blowup already fixed for
    log viewers.

    Returns the row count for the named table only; dependent rows removed
    to keep the database consistent are not counted.
    """
    model = dict(_TABLE_SECTIONS).get(name)
    if model is None:
        raise ValueError(f"Unknown table: {name}")
    deleted = _scoped_delete(session, model, operator_id)

    if name == "posts":
        # Posts own dependent rows elsewhere; every other delete path
        # (retention sweep, reset & sync) clears these together. Leaving
        # post_sync_state behind is the dangerous one: it still claims the
        # posts were seen, so a later sync would skip re-fetching them.
        for dependent in (PostEmbedding, PostTranslation, PostSyncState):
            _scoped_delete(session, dependent, operator_id)

    # Companion payload tables have no FK to cascade from — they stay
    # truncatable on their own — so clearing the parent has to clear them
    # explicitly or the heavy half is orphaned with nothing pointing at it.
    for parent, payload in (
        ("summaries", SummaryPayload),
        ("sync_logs", SyncLogPayload),
    ):
        if name == parent:
            _scoped_delete(session, payload, operator_id)

    session.commit()
    return deleted
