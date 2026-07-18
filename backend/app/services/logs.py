"""Log upsert and delete helpers (extracted from data routes)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, TypeVar, cast

from sqlmodel import Session, SQLModel, col, select

from app.models_tg import (
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    PublishLog,
    SyncLog,
)
from app.services.serialization import (
    embedding_log_to_camel,
    llm_log_to_camel,
    network_log_to_camel,
    normalize_body,
    publish_log_to_camel,
    sync_log_to_camel,
)

LogModel = TypeVar("LogModel", bound=SQLModel)

# Log list endpoints are viewers, not exports: cap what one request can load.
DEFAULT_LOG_PAGE_SIZE = 500
MAX_LOG_PAGE_SIZE = 5000

LOG_MODELS: dict[str, tuple[type[SQLModel], str]] = {
    "publish": (PublishLog, "publish_logs"),
    "sync": (SyncLog, "sync_logs"),
    "llm": (LLMLog, "llm_logs"),
    "embedding": (EmbeddingLog, "embedding_logs"),
    "network": (NetworkLog, "network_logs"),
}


def upsert_publish_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    normalized = normalize_body(item)
    log_id = normalized.get("id") or str(uuid.uuid4())
    existing = session.get(PublishLog, log_id)
    fields = {
        "user_id": user_id,
        "summary_id": normalized.get("summary_id", ""),
        "bot_id": normalized.get("bot_id", ""),
        "bot_name": normalized.get("bot_name", ""),
        "chat_id": normalized.get("chat_id", ""),
        "chat_name": normalized.get("chat_name", ""),
        "status": normalized.get("status", "success"),
        "error": normalized.get("error"),
        "timestamp": normalized.get("timestamp", 0),
        "full_request": normalized.get("full_request"),
        "full_response": normalized.get("full_response"),
        "text_sent": normalized.get("text_sent"),
    }
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
        existing.updated_at = datetime.utcnow()
        session.add(existing)
    else:
        session.add(PublishLog(id=log_id, **cast(Any, fields)))


def upsert_sync_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    normalized = normalize_body(item)
    log_id = normalized.get("id") or str(uuid.uuid4())
    existing = session.get(SyncLog, log_id)
    fields = {
        "user_id": user_id,
        "channel_name": normalized.get("channel_name", ""),
        "status": normalized.get("status", "success"),
        "posts_count": normalized.get("posts_count", 0),
        "new_latest_id": normalized.get("new_latest_id"),
        "error": normalized.get("error"),
        "timestamp": normalized.get("timestamp", 0),
        "source": normalized.get("source", ""),
        "full_request": normalized.get("full_request"),
        "full_response": normalized.get("full_response"),
    }
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
        existing.updated_at = datetime.utcnow()
        session.add(existing)
    else:
        session.add(SyncLog(id=log_id, **cast(Any, fields)))


def upsert_llm_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    normalized = normalize_body(item)
    log_id = normalized.get("id") or str(uuid.uuid4())
    existing = session.get(LLMLog, log_id)
    fields = {
        "user_id": user_id,
        "model": normalized.get("model", ""),
        "prompt": normalized.get("prompt", ""),
        "response": normalized.get("response", ""),
        "system_instruction": normalized.get("system_instruction"),
        "model_config_json": normalized.get("model_config_json"),
        "full_request": normalized.get("full_request"),
        "full_response": normalized.get("full_response"),
        "tokens": normalized.get("tokens"),
        "duration": normalized.get("duration"),
        "status": normalized.get("status", "success"),
        "error": normalized.get("error"),
        "timestamp": normalized.get("timestamp", 0),
        "log_type": normalized.get("log_type") or normalized.get("type", "summary"),
    }
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
        existing.updated_at = datetime.utcnow()
        session.add(existing)
    else:
        session.add(LLMLog(id=log_id, **cast(Any, fields)))


def upsert_embedding_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    normalized = normalize_body(item)
    log_id = normalized.get("id") or str(uuid.uuid4())
    existing = session.get(EmbeddingLog, log_id)
    fields = {
        "user_id": user_id,
        "text_count": normalized.get("text_count", 0),
        "tokens_estimated": normalized.get("tokens_estimated"),
        "duration": normalized.get("duration", 0),
        "status": normalized.get("status", "success"),
        "error": normalized.get("error"),
        "timestamp": normalized.get("timestamp", 0),
    }
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
        existing.updated_at = datetime.utcnow()
        session.add(existing)
    else:
        session.add(EmbeddingLog(id=log_id, **cast(Any, fields)))


def upsert_network_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    normalized = normalize_body(item)
    log_id = normalized.get("id") or str(uuid.uuid4())
    existing = session.get(NetworkLog, log_id)
    fields = {
        "user_id": user_id,
        "url": normalized.get("url", ""),
        "method": normalized.get("method", "GET"),
        "status": normalized.get("status", "success"),
        "status_code": normalized.get("status_code"),
        "error": normalized.get("error"),
        "duration": normalized.get("duration", 0),
        "timestamp": normalized.get("timestamp", 0),
        "source": normalized.get("source", ""),
        "proxy_used": normalized.get("proxy_used"),
        "attempts": normalized.get("attempts"),
        "telemetry": normalized.get("telemetry"),
    }
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
        existing.updated_at = datetime.utcnow()
        session.add(existing)
    else:
        session.add(NetworkLog(id=log_id, **cast(Any, fields)))


def delete_log_by_id(session: Session, log_type: str, log_id: str) -> bool:
    model, _ = LOG_MODELS[log_type]
    row = session.get(model, log_id)
    if not row:
        return False
    session.delete(row)
    session.commit()
    return True


def clear_logs(session: Session, log_type: str) -> int:
    model, _ = LOG_MODELS[log_type]
    rows = session.exec(select(model)).all()
    count = len(rows)
    for row in rows:
        session.delete(row)
    if count:
        session.commit()
    return count


def delete_old_logs(
    session: Session,
    older_than_days: int,
    *,
    operator_id: uuid.UUID | None = None,
) -> dict[str, int]:
    from app.services.operator import get_operator_user_id

    if operator_id is None:
        operator_id = get_operator_user_id(session)
    cutoff = (
        int(datetime.utcnow().timestamp() * 1000)
        - older_than_days * 24 * 60 * 60 * 1000
    )
    deleted: dict[str, int] = {}
    for log_type, (model, _) in LOG_MODELS.items():
        stmt = select(model).where(col(cast(Any, model).timestamp) < cutoff)
        if operator_id is not None and hasattr(model, "user_id"):
            user_id_col = cast(Any, model).user_id
            stmt = stmt.where(
                (col(user_id_col) == operator_id) | col(user_id_col).is_(None)
            )
        rows = session.exec(stmt).all()
        for row in rows:
            session.delete(row)
        if rows:
            session.commit()
        deleted[log_type] = len(rows)
    return deleted


def list_publish_logs(session: Session) -> list[dict[str, Any]]:
    return [publish_log_to_camel(log) for log in session.exec(select(PublishLog)).all()]


def list_sync_logs(
    session: Session, *, limit: int = DEFAULT_LOG_PAGE_SIZE, offset: int = 0
) -> list[dict[str, Any]]:
    """Return the newest sync logs, capped.

    tg_sync_logs carries a full_request/full_response JSON payload per row and
    grows without bound between retention sweeps. Selecting the whole table
    materialised every payload at once, which OOM-killed the worker; keep this
    bounded and newest-first (the order the UI displays anyway).
    """
    statement = (
        select(SyncLog)
        .order_by(col(SyncLog.timestamp).desc())
        .offset(offset)
        .limit(limit)
    )
    return [sync_log_to_camel(log) for log in session.exec(statement).all()]


def list_llm_logs(session: Session) -> list[dict[str, Any]]:
    return [llm_log_to_camel(log) for log in session.exec(select(LLMLog)).all()]


def list_embedding_logs(session: Session) -> list[dict[str, Any]]:
    return [
        embedding_log_to_camel(log) for log in session.exec(select(EmbeddingLog)).all()
    ]


def list_network_logs(session: Session) -> list[dict[str, Any]]:
    return [network_log_to_camel(log) for log in session.exec(select(NetworkLog)).all()]


def create_logs(
    session: Session,
    log_type: str,
    body: list[dict[str, Any]],
    *,
    user_id: uuid.UUID | None = None,
) -> dict[str, int]:
    upsert_fn = {
        "publish": upsert_publish_log,
        "sync": upsert_sync_log,
        "llm": upsert_llm_log,
        "embedding": upsert_embedding_log,
        "network": upsert_network_log,
    }[log_type]
    resource = LOG_MODELS[log_type][1]
    for item in body:
        upsert_fn(session, item, user_id)
    session.commit()
    from app.services.sync_meta import touch_sync

    touch_sync(session, resource)
    return {"upserted": len(body)}
