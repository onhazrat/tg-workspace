"""Log upsert and delete helpers (extracted from data routes)."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any, cast

from sqlalchemy import delete as sa_delete
from sqlmodel import Session, SQLModel, col, or_, select

from app.models_tg import (
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    PublishLog,
    SyncLog,
    SyncLogPayload,
    utc_now,
)
from app.services.serialization import (
    embedding_log_to_camel,
    llm_log_to_camel,
    network_log_to_camel,
    normalize_body,
    publish_log_to_camel,
    sync_log_to_camel,
)

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
        existing.updated_at = utc_now()
        session.add(existing)
    else:
        session.add(PublishLog(id=log_id, **cast(Any, fields)))


def upsert_sync_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    """Write a sync log, routing its bulk bodies to `SyncLogPayload`.

    The caller still passes one flat dict — the split is an implementation
    detail of how the rows are stored, not of the API.
    """
    normalized = normalize_body(item)
    log_id = normalized.get("id") or str(uuid.uuid4())
    existing = session.get(SyncLog, log_id)
    timestamp = normalized.get("timestamp", 0)
    fields = {
        "user_id": user_id,
        "channel_name": normalized.get("channel_name", ""),
        "status": normalized.get("status", "success"),
        "posts_count": normalized.get("posts_count", 0),
        "new_latest_id": normalized.get("new_latest_id"),
        "error": normalized.get("error"),
        "timestamp": timestamp,
        "source": normalized.get("source", ""),
    }
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
        existing.updated_at = utc_now()
        session.add(existing)
    else:
        session.add(SyncLog(id=log_id, **cast(Any, fields)))

    _upsert_sync_log_payload(
        session,
        log_id,
        user_id=user_id,
        timestamp=timestamp,
        full_request=normalized.get("full_request"),
        full_response=normalized.get("full_response"),
    )


def _upsert_sync_log_payload(
    session: Session,
    log_id: str,
    *,
    user_id: uuid.UUID | None,
    timestamp: int,
    full_request: Any,
    full_response: Any,
) -> None:
    """Store, update or clear one sync log's payload row.

    A log with no bodies gets no payload row at all, and re-importing one
    without bodies clears any row left over from a previous import, so the
    payload table never accumulates rows that carry nothing.
    """
    existing = session.get(SyncLogPayload, log_id)
    if full_request is None and full_response is None:
        if existing:
            session.delete(existing)
        return

    if existing:
        existing.user_id = user_id
        existing.timestamp = timestamp
        existing.full_request = full_request
        existing.full_response = full_response
        existing.updated_at = utc_now()
        session.add(existing)
        return

    session.add(
        SyncLogPayload(
            sync_log_id=log_id,
            user_id=user_id,
            timestamp=timestamp,
            full_request=full_request,
            full_response=full_response,
        )
    )


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
        existing.updated_at = utc_now()
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
        existing.updated_at = utc_now()
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
        existing.updated_at = utc_now()
        session.add(existing)
    else:
        session.add(NetworkLog(id=log_id, **cast(Any, fields)))


def delete_log_by_id(session: Session, log_type: str, log_id: str) -> bool:
    model, _ = LOG_MODELS[log_type]
    row = session.get(model, log_id)
    if not row:
        return False
    session.delete(row)
    if log_type == "sync":
        # tg_sync_log_payloads has no FK to cascade from — see SyncLogPayload.
        payload = session.get(SyncLogPayload, log_id)
        if payload:
            session.delete(payload)
    session.commit()
    return True


def clear_logs(session: Session, log_type: str) -> int:
    """Delete every row of one log table, returning the count.

    Bulk SQL DELETE rather than select-all-then-ORM-delete: log rows carry
    request/response payloads, so materialising the whole table to delete it
    pulled gigabytes into the worker. Mirrors
    `app.jobs.retention.run_retention_cleanup`.
    """
    model, _ = LOG_MODELS[log_type]
    result = session.execute(sa_delete(model))
    if log_type == "sync":
        session.execute(sa_delete(SyncLogPayload))
    session.commit()
    return cast(Any, result).rowcount or 0


def delete_old_logs(
    session: Session,
    older_than_days: int,
    *,
    operator_id: uuid.UUID | None = None,
) -> dict[str, int]:
    from app.services.operator import get_operator_user_id

    if operator_id is None:
        operator_id = get_operator_user_id(session)
    cutoff = int(utc_now().timestamp() * 1000) - older_than_days * 24 * 60 * 60 * 1000
    deleted: dict[str, int] = {}
    for log_type, (model, _) in LOG_MODELS.items():
        # Bulk DELETE in the database — see clear_logs above for why.
        stmt = sa_delete(model).where(col(cast(Any, model).timestamp) < cutoff)
        if operator_id is not None and hasattr(model, "user_id"):
            user_id_col = cast(Any, model).user_id
            stmt = stmt.where(
                or_(col(user_id_col) == operator_id, col(user_id_col).is_(None))
            )
        result = session.execute(stmt)
        if log_type == "sync":
            session.execute(expire_sync_payloads_stmt(cutoff, operator_id))
        session.commit()
        deleted[log_type] = cast(Any, result).rowcount or 0
    return deleted


def expire_sync_payloads_stmt(cutoff: int, operator_id: uuid.UUID | None) -> Any:
    """Bulk DELETE of sync payloads older than `cutoff`.

    Filters on the payload table's own denormalised timestamp so the sweep
    never joins back to tg_sync_logs. Shared by the log-deletion paths here and
    by `app.jobs.retention`, which also runs it on the shorter payload horizon.
    """
    stmt = sa_delete(SyncLogPayload).where(col(SyncLogPayload.timestamp) < cutoff)
    if operator_id is not None:
        stmt = stmt.where(
            or_(
                col(SyncLogPayload.user_id) == operator_id,
                col(SyncLogPayload.user_id).is_(None),
            )
        )
    return stmt


def _list_logs_page[LogModel: SQLModel](
    session: Session,
    model: type[LogModel],
    timestamp_col: Any,
    to_camel: Callable[[Any], dict[str, Any]],
    *,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    """Return one newest-first page of a log table.

    Log rows carry request/response JSON payloads and the tables grow without
    bound between retention sweeps, so an unfiltered select can materialise
    gigabytes at once and OOM the worker. Every viewer endpoint goes through
    here; full data still ships via the export path, which streams.

    The ordering column is passed in rather than read off the type variable so
    it stays statically checkable.
    """
    statement = select(model).order_by(timestamp_col.desc()).offset(offset).limit(limit)
    return [to_camel(row) for row in session.exec(statement).all()]


def list_publish_logs(
    session: Session, *, limit: int = DEFAULT_LOG_PAGE_SIZE, offset: int = 0
) -> list[dict[str, Any]]:
    return _list_logs_page(
        session,
        PublishLog,
        col(PublishLog.timestamp),
        publish_log_to_camel,
        limit=limit,
        offset=offset,
    )


def list_sync_logs(
    session: Session, *, limit: int = DEFAULT_LOG_PAGE_SIZE, offset: int = 0
) -> list[dict[str, Any]]:
    """Return one newest-first page of sync logs, payloads included.

    The one lister that does not go through `_list_logs_page`, because the
    bodies live in tg_sync_log_payloads. The join is an OUTER one on purpose:
    that table can be truncated at any time to reclaim disk, and a log whose
    payload is gone must still list — it just reports null bodies. Same page
    caps apply, since the payloads still ship inline.
    """
    statement = (
        select(SyncLog, SyncLogPayload)
        .join(
            SyncLogPayload,
            col(SyncLogPayload.sync_log_id) == col(SyncLog.id),
            isouter=True,
        )
        .order_by(col(SyncLog.timestamp).desc())
        .offset(offset)
        .limit(limit)
    )
    return [sync_log_to_camel(log, payload) for log, payload in session.exec(statement)]


def list_llm_logs(
    session: Session, *, limit: int = DEFAULT_LOG_PAGE_SIZE, offset: int = 0
) -> list[dict[str, Any]]:
    return _list_logs_page(
        session,
        LLMLog,
        col(LLMLog.timestamp),
        llm_log_to_camel,
        limit=limit,
        offset=offset,
    )


def list_embedding_logs(
    session: Session, *, limit: int = DEFAULT_LOG_PAGE_SIZE, offset: int = 0
) -> list[dict[str, Any]]:
    return _list_logs_page(
        session,
        EmbeddingLog,
        col(EmbeddingLog.timestamp),
        embedding_log_to_camel,
        limit=limit,
        offset=offset,
    )


def list_network_logs(
    session: Session, *, limit: int = DEFAULT_LOG_PAGE_SIZE, offset: int = 0
) -> list[dict[str, Any]]:
    return _list_logs_page(
        session,
        NetworkLog,
        col(NetworkLog.timestamp),
        network_log_to_camel,
        limit=limit,
        offset=offset,
    )


#: `log_type` -> the function that returns one page of it.
#:
#: The dispatch table that lets one endpoint serve all five. Adding a sixth log
#: type means a table, a serialiser, a response model and one line here — not a
#: new pair of routes, a new service function and a new frontend hook.
LOG_LISTERS: dict[str, Callable[..., list[dict[str, Any]]]] = {
    "publish": list_publish_logs,
    "sync": list_sync_logs,
    "llm": list_llm_logs,
    "embedding": list_embedding_logs,
    "network": list_network_logs,
}


def list_logs(
    session: Session,
    log_type: str,
    *,
    limit: int = DEFAULT_LOG_PAGE_SIZE,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """One newest-first page of any log type.

    Raises `KeyError` for an unknown type; the route turns that into a 400 so
    the error contract matches the purge endpoint, which has always 400ed rather
    than 404ed on a bad `type`.
    """
    return LOG_LISTERS[log_type](session, limit=limit, offset=offset)


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
