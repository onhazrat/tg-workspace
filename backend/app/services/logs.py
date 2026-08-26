"""Log upsert and delete helpers (extracted from data routes)."""

from __future__ import annotations

import uuid
from typing import Any, cast

from fastapi import HTTPException
from sqlalchemy import Text
from sqlalchemy import cast as sa_cast
from sqlalchemy import delete as sa_delete
from sqlalchemy import select as sa_select
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
    mapping_to_camel,
    model_to_camel,
    normalize_body,
    sync_log_to_camel,
)
from app.services.tenancy import assert_owner, scoped_select, unscoped_select

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

#: Log types that belong to no single account, so a read of them crosses
#: accounts on purpose (ticket 18).
#:
#: A network log records what the deployment's *proxies* did. There is no
#: account whose rows they are, so decision 23 keeps a nullable `user_id` for
#: whoever triggered the request and makes the family Admin-only, on the
#: reasoning that a nullable owner leaking only to an Admin is an acceptable
#: failure mode. `NetworkLog` stays `USER_OWNED` in `tenancy.SCOPES` and the
#: read goes through `unscoped_select` instead, because an escape hatch is only
#: meaningful where the default would have scoped — the same argument
#: `QuotaUsage` makes.
#:
#: `routes/data/logs.py` reads this to decide which types demand
#: `Permission.LOGS_READ_ANY`. One set rather than two lists, so the route's
#: gate and this module's scoping cannot come to disagree about which types
#: those are: a family readable by anyone *and* unscoped is the worst of both.
ADMIN_ONLY_LOG_TYPES = frozenset({"network"})

#: Why the reads below cross accounts for those types, in the one place
#: `unscoped_select` exists to record it.
_ADMIN_LOG_REASON = (
    "Network logs are Admin-only (decision 23): they record proxy behaviour for "
    "the deployment rather than for an account, and the route above this "
    "demands Permission.LOGS_READ_ANY before it runs."
)


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


#: Columns a *list* page does not select, per log type.
#:
#: `GET /data/logs/sync` returned **56.28 MB for one page of 500 rows, 99.7% of
#: it request/response bodies**, in 0.87s of server time — a transfer problem,
#: not a query one. The viewer renders none of it until a row is expanded, and
#: it expands one row at a time, so the list ships metadata and
#: `GET /data/logs/{type}/{id}` fetches the bodies for the row actually opened.
#:
#: Sync is absent because its bodies are not columns of `tg_sync_logs` at all —
#: they live in `tg_sync_log_payloads`, and the list simply does not join it.
#: Network is absent because `telemetry` was measured at 174 bytes a row: real
#: enough to look heavy, small enough that dropping it would be churn.
LOG_HEAVY_COLUMNS: dict[str, frozenset[str]] = {
    "publish": frozenset({"full_request", "full_response", "text_sent"}),
    "sync": frozenset(),
    "llm": frozenset(
        {"prompt", "response", "system_instruction", "full_request", "full_response"}
    ),
    "embedding": frozenset(),
    "network": frozenset(),
}


#: Columns a text search matches, per type — exactly the fields the Logs view
#: used to scan client-side over the fetched page.
#:
#: Moving this to SQL is what lets `text_sent`, `prompt` and `response` stay
#: *searchable* while no longer being *shipped*, and it searches the whole table
#: rather than the 500 rows that happened to be on the page.
LOG_SEARCH_COLUMNS: dict[str, tuple[str, ...]] = {
    "publish": ("bot_name", "chat_name", "chat_id", "error", "text_sent"),
    "sync": ("channel_name", "source", "error"),
    "llm": ("model", "prompt", "response", "error"),
    "embedding": ("text_count", "error"),
    "network": ("url", "method", "error"),
}

#: Additionally matched when the view's "search in details" box is ticked.
#: Sync's bodies are not here because they are not columns of `tg_sync_logs` —
#: `_log_search_clause` reaches them through an EXISTS on the payload table.
LOG_DETAIL_SEARCH_COLUMNS: dict[str, tuple[str, ...]] = {
    "publish": ("full_request", "full_response"),
    "sync": (),
    "llm": ("full_request", "full_response"),
    "embedding": (),
    "network": ("telemetry",),
}


def _log_search_clause(log_type: str, term: str, *, in_details: bool) -> Any:
    """Case-insensitive substring match, mirroring the old client-side filter.

    JSON columns are matched as text, which is what `jsonIncludes` did with
    `JSON.stringify`. The two serialisations differ in whitespace, so a query
    containing punctuation between keys could match in one and not the other;
    for the word-ish queries this box takes they agree.
    """
    model, _ = LOG_MODELS[log_type]
    table = _log_table(model)
    like = f"%{term}%"
    clauses: list[Any] = [
        sa_cast(table.c[name], Text).ilike(like)
        for name in LOG_SEARCH_COLUMNS[log_type]
    ]
    if in_details:
        clauses += [
            sa_cast(table.c[name], Text).ilike(like)
            for name in LOG_DETAIL_SEARCH_COLUMNS[log_type]
        ]
        if log_type == "sync":
            # `IN (uncorrelated subquery)`, not a correlated EXISTS. The
            # EXISTS reads more naturally but is evaluated once per candidate
            # log row, so it scales with `tg_sync_logs` (191k rows) rather than
            # with the payload table. This runs the ILIKE once over the payloads
            # and semi-joins the result.
            #
            # Measured on staging: 5.81s -> 4.54s. The gain is modest and the
            # residual is not the join — it is detoasting ~5,700 bodies to match
            # them, which is what searching bodies costs. That is why it is
            # behind a checkbox, and why nothing else on this path pays it.
            clauses.append(
                table.c.id.in_(
                    sa_select(col(SyncLogPayload.sync_log_id)).where(
                        or_(
                            sa_cast(col(SyncLogPayload.full_request), Text).ilike(like),
                            sa_cast(col(SyncLogPayload.full_response), Text).ilike(
                                like
                            ),
                        )
                    )
                )
            )
    return or_(*clauses)


def _log_table(model: type[SQLModel]) -> Any:
    """The mapped table. `__table__` is set by SQLModel's metaclass at runtime."""
    return cast(Any, model).__table__


def _light_columns(model: type[SQLModel], heavy: frozenset[str]) -> list[Any]:
    """The model's columns minus the heavy ones, for an explicit column select.

    Selecting columns rather than the entity is deliberate. `defer()` would keep
    the ORM object, and `model_to_camel` calls `model_dump()` — which touches
    every attribute and would fire one lazy SELECT per deferred column per row.
    A silent N+1 in place of a large payload is not a fix.
    """
    return [c for c in _log_table(model).columns if c.key not in heavy]


def _list_logs_page(
    session: Session,
    log_type: str,
    *,
    user_id: uuid.UUID,
    limit: int,
    offset: int,
    search: str | None,
    search_in_details: bool,
) -> list[dict[str, Any]]:
    """Return one newest-first page of a log table, without its heavy columns.

    Log tables grow without bound between retention sweeps, so this is paged;
    full data still ships via the export path, which streams.

    All five types share this one path now. Sync used to have its own because it
    joined `tg_sync_log_payloads` to fold the bodies back in — dropping that join
    is what makes it ordinary.
    """
    model, _ = LOG_MODELS[log_type]
    table = _log_table(model)
    columns = _light_columns(model, LOG_HEAVY_COLUMNS[log_type])
    statement = select(*columns)
    # The predicate goes on before the ordering, the offset and the limit, and
    # it has to: a page ranked over rows the caller cannot see would hand back
    # fewer than `limit` of them, or none at all, while the rows it skipped sit
    # in someone else's account. Same shape as the feed's window in ticket 16.
    if log_type in ADMIN_ONLY_LOG_TYPES:
        statement = unscoped_select(statement, reason=_ADMIN_LOG_REASON)
    else:
        statement = scoped_select(statement, model, user_id)
    if search and search.strip():
        statement = statement.where(
            _log_search_clause(log_type, search.strip(), in_details=search_in_details)
        )
    statement = statement.order_by(table.c.timestamp.desc()).offset(offset).limit(limit)
    return [
        {"id": row._mapping["id"], **mapping_to_camel(dict(row._mapping))}
        for row in session.execute(statement).all()
    ]


def list_logs(
    session: Session,
    log_type: str,
    *,
    user_id: uuid.UUID,
    limit: int = DEFAULT_LOG_PAGE_SIZE,
    offset: int = 0,
    search: str | None = None,
    search_in_details: bool = False,
) -> list[dict[str, Any]]:
    """One newest-first page of any log type, in the light projection.

    **This must not read the heavy columns**, and for sync it must not open
    `tg_sync_log_payloads` at all — pinned by
    `tests/services/test_log_list_payload_cost.py`. `search` is the exception
    and the reason the split works: the bodies stay searchable in SQL without
    being sent, exactly as `services/summaries.py::_search_clause` does.

    Raises `KeyError` for an unknown type; the route turns that into a 400 so
    the error contract matches the purge endpoint, which has always 400ed rather
    than 404ed on a bad `type`.

    `user_id` is required and has no default, for the reason `scoped_select`
    gives: every caller of this already depends on `CurrentUser`, and a default
    would let a new one scope to nobody without saying so.
    """
    if log_type not in LOG_MODELS:
        raise KeyError(log_type)
    return _list_logs_page(
        session,
        log_type,
        user_id=user_id,
        limit=limit,
        offset=offset,
        search=search,
        search_in_details=search_in_details,
    )


def get_log(
    session: Session, log_type: str, log_id: str, *, user_id: uuid.UUID
) -> dict[str, Any]:
    """One log row in full, including whatever the list projection dropped.

    The other half of the split: the viewer calls this for the single row the
    operator expanded, so the bodies are fetched once for one row rather than
    500 times for rows nobody opened.

    A row belonging to someone else answers 404 with **the same detail an absent
    row answers**, not 403. 403 would confirm the row exists, and the whole
    reason `assert_owner` demands the string is that a distinguishable body
    moves that oracle from the status line into the payload.
    """
    model, _ = LOG_MODELS[log_type]
    row = session.get(model, log_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"{log_type} log not found")
    if log_type not in ADMIN_ONLY_LOG_TYPES:
        assert_owner(
            getattr(row, "user_id", None),
            user_id,
            detail=f"{log_type} log not found",
        )
    if log_type == "sync":
        return sync_log_to_camel(
            cast(SyncLog, row), session.get(SyncLogPayload, log_id)
        )
    return {"id": log_id, **model_to_camel(row)}


def create_logs(
    session: Session,
    log_type: str,
    body: list[dict[str, Any]],
    *,
    user_id: uuid.UUID,
) -> dict[str, int]:
    """Upsert a batch of log rows, refusing rows the caller does not own.

    **The write is in scope, and the ticket's checkboxes did not say so.** Every
    `upsert_*_log` merges into whatever row its `id` names and reassigns
    `user_id` while it is there, so scoping the *read* over a writable row
    leaves the whole family one guessed id away: a caller posting another
    account's log id overwrites that row and becomes its owner, and every read
    guard passes throughout. Ticket 17 found the identical shape in the four
    artifact families; this is that fix, one ticket later, in the one place the
    API enters.

    The check is here rather than inside the five upserts because those have
    other callers — the publisher, the scraper, the embedding job — that write
    rows on an account's behalf and legitimately name any owner. This function
    is the API's door, and it always has a real caller behind it, which is why
    `user_id` lost its default.

    An absent id still creates, which is what keeps an upsert an upsert.

    All five types, network included. Network *reads* are Admin-only and cross
    accounts, but a write landing on an existing row is an overwrite either way,
    and none of the six frontend flows that record network telemetry ever
    updates one — `writeLog` mints a fresh id every time. One rule over five
    types beats a rule over four plus a paragraph excusing the fifth.
    """
    model, _ = LOG_MODELS[log_type]
    for item in body:
        log_id = normalize_body(item).get("id")
        if not log_id:
            continue
        existing = session.get(model, log_id)
        if existing is not None:
            assert_owner(
                getattr(existing, "user_id", None),
                user_id,
                detail=f"{log_type} log not found",
            )

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
