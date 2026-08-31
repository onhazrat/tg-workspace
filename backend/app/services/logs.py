"""Log upsert and delete helpers (extracted from data routes)."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterable, Sequence
from typing import Any, NamedTuple, cast

from fastapi import HTTPException
from sqlalchemy import Text
from sqlalchemy import cast as sa_cast
from sqlalchemy import delete as sa_delete
from sqlalchemy import select as sa_select
from sqlmodel import Session, SQLModel, col, or_, select

from app.models_tg import (
    Channel,
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
from app.services.tenancy import (
    Scope,
    assert_owner,
    assert_owner_on_write,
    scope_of,
    scoped_select,
    tenancy_enforced,
    unscoped_select,
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


def _shared_log_types() -> frozenset[str]:
    """Log types no single account owns a row of. Derived, never listed.

    These are exactly the types `get_log` does **not** owner-check: the
    Admin-only ones, whose rows record what the deployment's proxies did, and
    the follow-scoped ones, whose rows are a fact about a Channel. For both, a
    single-row delete takes something away from somebody other than the caller,
    so `routes/data/logs.py` gates that branch on `Permission.DATA_ADMIN`.

    Computed from `tenancy.SCOPES` rather than written out, because a
    hand-maintained second list is the drift this programme keeps finding: a
    type reclassified in the seam and forgotten here would go on being deletable
    by anyone who can name its id, and every read guard would still pass.
    """
    return frozenset(
        log_type
        for log_type, (model, _) in LOG_MODELS.items()
        if log_type in ADMIN_ONLY_LOG_TYPES or scope_of(model) is not Scope.USER_OWNED
    )


#: The answer, resolved once at import. `tenancy` is a pure transform with no
#: database access, so classifying the five types costs nothing here.
SHARED_LOG_TYPES = _shared_log_types()

#: The types one account does own rows of, so the window that account sets is
#: what sweeps them (ticket 20). The complement, derived for the same reason
#: `SHARED_LOG_TYPES` is derived: two hand-written lists are two chances to
#: disagree, and the disagreement here would be a family swept by nobody or by
#: everybody.
#:
#: Membership is about the *family*, not about a given row, and ticket 21
#: narrowed what that distinction covers. It used to be that `user_id` was
#: nullable on all five tables and a background job wrote rows with no owner as
#: a matter of course, so a *personal* family still had rows reachable only by
#: the deployment window. PR 1 made the four personal `upsert_*` take a required
#: owner and PR 3 made those four columns `NOT NULL`, so the only family that
#: can still hold an unowned row is `sync` — which stores no owner by design
#: (ticket 19) and is shared anyway.
#:
#: `delete_unowned_logs_before` therefore now reaches sync-log rows and nothing
#: else. It is kept rather than folded into the shared sweep because a database
#: restored from before those PRs still holds unowned personal rows, and they
#: would otherwise be swept by no window at all — the leak ticket 20 closed.
PERSONAL_LOG_TYPES = frozenset(LOG_MODELS) - SHARED_LOG_TYPES


#: Why the reads below cross accounts for those types, in the one place
#: `unscoped_select` exists to record it.
_ADMIN_LOG_REASON = (
    "Network logs are Admin-only (decision 23): they record proxy behaviour for "
    "the deployment rather than for an account, and the route above this "
    "demands Permission.LOGS_READ_ANY before it runs."
)


def upsert_publish_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID
) -> None:
    """Write a publish log for `user_id`.

    **`user_id` is required and non-optional**, as it is on the three personal
    log families below. It was `uuid.UUID | None = None` until ticket 21, and
    the default was doing real damage rather than sitting unused: `PublishLog`,
    `LLMLog`, `EmbeddingLog` and `NetworkLog` are all `USER_OWNED` in `SCOPES`,
    so a row written with no owner is invisible to every account under
    enforcement — and ticket 20 runs these four on *their owner's*
    `logRetentionDays`, which means an unowned one is also reachable by no
    retention window at all. It leaks by never being swept.

    Ticket 34's migration backfilled the rows that existed and deliberately left
    the column nullable, so these four signatures are what kept producing more.
    Removing the default is what makes the callers say who they are: `mypy`
    names every one of them rather than leaving the gap to be found on the day
    the flag flips.

    `upsert_sync_log` takes **no** owner at all since ticket 22, which is where
    the five families stopped sharing one signature — see its docstring for why
    a parameter that is accepted and ignored had to go rather than stay. The
    dispatch tables in `create_logs` and `data_import_export._import_logs` name
    that asymmetry in a visible branch instead of hiding it behind a signature
    that lies.
    """
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


def upsert_sync_log(session: Session, item: dict[str, Any]) -> None:
    """Write a sync log, routing its bulk bodies to `SyncLogPayload`.

    The caller still passes one flat dict — the split is an implementation
    detail of how the rows are stored, not of the API.

    **There is no owner to pass** (ticket 19, plan decision 22; column and
    parameter dropped in ticket 22). A sync log is channel telemetry: it answers
    "did this Channel deliver Posts, and if not why not", which is a fact about
    the Channel rather than about whoever triggered the scrape, so
    `tenancy.SCOPES` makes it follow-scoped and nothing reads an owner off it.
    Keeping a nullable owner that means "the scheduler wrote this" is the
    `operator.py` ambiguity, and it fails open on a forgotten stamp.

    Ticket 19 kept a `user_id` parameter it deliberately ignored, so the five
    log families could share one dispatch signature, and said this ticket would
    drop it with the column. It is dropped: an ignored parameter decays into a
    written one the first time somebody tidies it, and the two dispatch tables
    now name the asymmetry explicitly instead of hiding it behind a signature
    that lies.
    """
    normalized = normalize_body(item)
    log_id = normalized.get("id") or str(uuid.uuid4())
    existing = session.get(SyncLog, log_id)
    timestamp = normalized.get("timestamp", 0)
    channel_name = normalized.get("channel_name", "")
    fields = {
        "channel_name": channel_name,
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
        channel_name=channel_name,
        timestamp=timestamp,
        full_request=normalized.get("full_request"),
        full_response=normalized.get("full_response"),
    )


def _upsert_sync_log_payload(
    session: Session,
    log_id: str,
    *,
    channel_name: str,
    timestamp: int,
    full_request: Any,
    full_response: Any,
) -> None:
    """Store, update or clear one sync log's payload row.

    A log with no bodies gets no payload row at all, and re-importing one
    without bodies clears any row left over from a previous import, so the
    payload table never accumulates rows that carry nothing.

    `channel_name` is denormalised from the parent, the way `timestamp` already
    is, because ticket 19 scopes this row by "do you follow this channel" and
    the seam correlates its EXISTS on a real column. It travels with the write
    rather than being read back off the log, so a payload row can never name a
    different channel than the log it belongs to. No owner is written, for the
    reason `upsert_sync_log` gives.
    """
    existing = session.get(SyncLogPayload, log_id)
    if full_request is None and full_response is None:
        if existing:
            session.delete(existing)
        return

    if existing:
        existing.channel_name = channel_name
        existing.timestamp = timestamp
        existing.full_request = full_request
        existing.full_response = full_response
        existing.updated_at = utc_now()
        session.add(existing)
        return

    session.add(
        SyncLogPayload(
            sync_log_id=log_id,
            channel_name=channel_name,
            timestamp=timestamp,
            full_request=full_request,
            full_response=full_response,
        )
    )


def upsert_llm_log(session: Session, item: dict[str, Any], user_id: uuid.UUID) -> None:
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
    session: Session, item: dict[str, Any], user_id: uuid.UUID
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
    session: Session, item: dict[str, Any], user_id: uuid.UUID
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


def collect_channel_sync_logs(session: Session, channel_name: str) -> int:
    """Delete every sync log for one Channel, with its payload rows.

    Called by `channels.collect_unfollowed_channel` when retention reclaims a
    Channel nobody follows. Ticket 19 made these two tables channel telemetry
    keyed by `channel_name`, which puts them in the same position as
    `tg_posts`: no foreign key to `tg_channels`, so nothing cascades.

    Stranding them is worse than stranding posts. Once the `tg_channels` row is
    gone there is no Follow for the seam's EXISTS to reach, so the rows are
    invisible to every account *and* still on disk — and they are the heaviest
    tables in the schema. `logRetentionDays` is the only other thing that would
    ever take them, and `run_retention_cleanup` skips log sweeps entirely when
    that window is 0.

    Payloads first, so a failure between the two statements leaves an orphaned
    log rather than an orphaned payload: the log is still reachable by the
    ordinary retention sweep, and a payload whose log is gone is not.

    Bulk DELETE, never load-then-delete, for the reason the caller gives: these
    rows carry request and response bodies, and materialising them to delete
    them is what OOM-killed the worker on staging.

    Does **not** commit; the caller owns the transaction.
    """
    session.execute(
        sa_delete(SyncLogPayload).where(
            col(SyncLogPayload.channel_name) == channel_name
        )
    )
    result = session.execute(
        sa_delete(SyncLog).where(col(SyncLog.channel_name) == channel_name)
    )
    return cast(Any, result).rowcount or 0


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


class LogSweep(NamedTuple):
    """What one sweep removed: rows per log type, and sync payload rows.

    The payload count is separate because `tg_sync_log_payloads` is not a log
    type — it is the bodies hanging off one. Folding it into `counts` under a
    sixth key would reach `routes/data/logs.py`, which maps every key through
    `LOG_MODELS` and would raise on a key that is not a family.
    """

    counts: dict[str, int]
    payloads: int


def _delete_logs_before(
    session: Session,
    cutoff: int,
    log_types: Iterable[str],
    owner_clause: Callable[[type[SQLModel]], Any] | None,
) -> LogSweep:
    """Bulk-delete expired rows of `log_types`, one committed DELETE per type.

    Bulk DELETE in the database, never select-all-then-ORM-delete: materialising
    every expired row pulled gigabytes into the worker and OOM-killed it.

    The sync payload table is swept alongside its parent whenever sync rows are
    in scope, because `tg_sync_log_payloads` has no FK to cascade from — the
    stranding ticket 19's review caught. `owner_clause` is `None` there and only
    there: a payload row's owner column is a pre-ticket-19 stamp, so narrowing
    the payload sweep by owner is what stranded the bodies in the first place.
    """
    deleted: dict[str, int] = {}
    payloads = 0
    for log_type in log_types:
        model, _ = LOG_MODELS[log_type]
        stmt = sa_delete(model).where(col(cast(Any, model).timestamp) < cutoff)
        if owner_clause is not None:
            stmt = stmt.where(owner_clause(model))
        result = session.execute(stmt)
        if log_type == "sync":
            payload_result = session.execute(expire_sync_payloads_stmt(cutoff))
            payloads += cast(Any, payload_result).rowcount or 0
        session.commit()
        deleted[log_type] = cast(Any, result).rowcount or 0
    return LogSweep(deleted, payloads)


def delete_logs_before(
    session: Session, cutoff: int, *, log_types: Iterable[str]
) -> LogSweep:
    """Every row of `log_types` older than `cutoff`, whoever owns it.

    The deployment's own sweep. Used for the families no single account owns —
    Channel telemetry and proxy behaviour — and by the Admin purge route, whose
    whole point is that it crosses accounts.
    """
    return _delete_logs_before(session, cutoff, log_types, None)


def delete_owned_logs_before(
    session: Session,
    cutoff: int,
    *,
    log_types: Iterable[str],
    user_ids: Sequence[uuid.UUID],
) -> LogSweep:
    """Rows of `log_types` older than `cutoff` belonging to `user_ids`.

    Takes a set of owners rather than one, so the retention job can sweep every
    account that chose the same window in a single DELETE per type instead of
    one per account per type. On a single-operator deployment that is exactly
    the query it ran before ticket 20.

    An empty `user_ids` returns early. SQLAlchemy renders an empty `IN` as a
    false expression, so this is not what makes the call safe — it is what
    stops five DELETE statements reaching the database to accomplish nothing,
    and what makes "nobody chose this window" visible at the call site rather
    than something you have to know a SQLAlchemy rendering rule to be sure of.
    """
    if not user_ids:
        return LogSweep(dict.fromkeys(log_types, 0), 0)
    owners = list(user_ids)
    return _delete_logs_before(
        session,
        cutoff,
        log_types,
        lambda model: col(cast(Any, model).user_id).in_(owners),
    )


def delete_unowned_logs_before(
    session: Session, cutoff: int, *, log_types: Iterable[str]
) -> LogSweep:
    """Rows of `log_types` older than `cutoff` that no account owns.

    Once the personal families are swept on their owner's own window, an
    unowned row is reachable by no window at all. This is the sweep that reaches
    them, on the deployment's `sharedLogRetentionDays`.

    **Ticket 21 shrank what it finds, and deliberately did not delete it.** When
    ticket 20 wrote this, `user_id` was nullable on all five log tables and
    every `upsert_*` took it as optional, so a background job writing an
    ownerless row was routine. PR 1 made the four personal writers require an
    owner and PR 3 made their columns `NOT NULL`, so on a database migrated to
    head the only rows here are sync logs, which carry no owner by design.

    It stays because a database restored from a backup taken before those PRs
    still holds unowned publish, LLM, embedding and network rows, and those are
    exactly the rows nothing else sweeps. A predicate that matches nothing on a
    current database and everything that matters on an old one is not dead code;
    it is the compatibility this function was written for in the first place.
    """
    return _delete_logs_before(
        session,
        cutoff,
        log_types,
        lambda model: col(cast(Any, model).user_id).is_(None),
    )


def delete_old_logs(session: Session, older_than_days: int) -> dict[str, int]:
    """Every log row older than `older_than_days`, for every account.

    The Admin purge route's sweep, which is Admin-gated precisely because it
    crosses accounts. It used to narrow itself to `user_id == operator OR IS
    NULL` — a filter that made an administrative sweep quietly skip every other
    account's rows while its own docstring said it swept them all. Ticket 19
    made sync logs Channel telemetry, which took the last argument for that
    filter away; ticket 20 removed it.
    """
    cutoff = int(utc_now().timestamp() * 1000) - older_than_days * 24 * 60 * 60 * 1000
    # `.counts` only: the route reports one number per log family and maps every
    # key through `LOG_MODELS`. The payload rows go with their parent either
    # way — see `LogSweep`.
    return delete_logs_before(session, cutoff, log_types=LOG_MODELS).counts


def expire_sync_payloads_stmt(cutoff: int) -> Any:
    """Bulk DELETE of sync payloads older than `cutoff`.

    Filters on the payload table's own denormalised timestamp so the sweep
    never joins back to tg_sync_logs. Shared by the log-deletion paths here and
    by `app.jobs.retention`, which also runs it on the shorter payload horizon.

    No owner filter, and there is nothing to add one from: a sync log is
    Channel telemetry after ticket 19 and `SyncLogPayload.user_id` is a stamp
    ticket 22 drops. Narrowing this to the operator was how payloads outlived
    the log rows they belonged to.
    """
    return sa_delete(SyncLogPayload).where(col(SyncLogPayload.timestamp) < cutoff)


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

    A follow-scoped type takes the other branch, and there the two answers are
    the *same code path* rather than two branches that have to be remembered to
    answer alike: the row is fetched through `scoped_select`, so "not there" and
    "not yours to see" are both an empty result. Ticket 19 makes sync logs the
    only such type today.
    """
    model, _ = LOG_MODELS[log_type]
    follow_scoped = scope_of(model) is Scope.FOLLOW_SCOPED
    row = (
        session.exec(
            scoped_select(
                select(model).where(col(cast(Any, model).id) == log_id),
                model,
                user_id,
            )
        ).first()
        if follow_scoped
        else session.get(model, log_id)
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"{log_type} log not found")
    if not follow_scoped and log_type not in ADMIN_ONLY_LOG_TYPES:
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


def _visible_channel_names_exact(session: Session, *, user_id: uuid.UUID) -> set[str]:
    """The Channel names `user_id` may see, compared the way the seam compares them.

    **Not `follows.visible_channel_names`, and the difference is load-bearing.**
    That one lowercases, because all three of its callers compare against a
    handle scraped out of a post and `discover.normalize_handle` has already
    lowercased that. This one feeds a write whose row is later read back through
    `scoped_select`, which emits `tg_channels.name = tg_sync_logs.channel_name`,
    an exact match in PostgreSQL.

    Mixing the two admits a row that can never be read: an account following
    `NewsHandle` would pass a case-insensitive write check for
    `"channelName": "newshandle"`, and the resulting log would then be invisible
    to every account including its author, because the EXISTS compares the
    stored spelling to the Channel's. A write guard that is looser than the read
    scope does not merely fail to protect, it manufactures unreachable rows.
    """
    return {
        str(name)
        for name in session.exec(
            scoped_select(select(Channel.name), Channel, user_id)
        ).all()
    }


def _assert_may_write_channel_telemetry(
    session: Session,
    body: list[dict[str, Any]],
    *,
    log_type: str,
    user_id: uuid.UUID,
) -> None:
    """Refuse telemetry for a Channel the caller does not Follow.

    The follow-scoped replacement for `assert_owner` on the write path. Two
    Two rules, and the second is the one that is easy to miss.

    **You may only write telemetry for a Channel you Follow.** An account cannot
    fabricate history for a Channel it does not watch.

    **Through this door the write is create-only.** An id that already names a
    row is refused outright rather than merged. `upsert_sync_log` overwrites
    `status`, `error`, `posts_count`, `new_latest_id`, `timestamp` and the
    bodies, so a merge lets one Follower rewrite telemetry every other Follower
    reads — and `routes/data/logs.py` gates the single-row *delete* on
    `DATA_ADMIN` precisely because destroying that record is not one Follower's
    to do. An overwrite destroys the same record and would have been left open;
    checking that the caller can see the row it is about to flatten is not a
    check that it may flatten it. Appending is not administrative, rewriting is,
    and the id is the part being guessed either way.

    The internal writers are unaffected, which is what makes create-only cheap:
    `sync_orchestrator` mints a fresh uuid per attempt and `data_import_export`
    calls `upsert_sync_log` directly. This function is only the API's door, and
    `saveSyncLog` in the frontend is exported and called by nothing.

    A no-op while `tenancy_enforced()` says so, which is the promise every batch
    of this programme makes. It matters here rather than being a formality: with
    the flag off every Channel is visible, so without the early return a log
    naming a handle that has no `tg_channels` row yet would start being refused
    today, and so would a re-POST of an existing id. Nothing in the app does
    either, but the import path accepts arbitrary history and that is not a
    response this ticket is allowed to change.

    An unnamed Channel is refused under enforcement. `""` is not a handle anyone
    can Follow, and telemetry that names no Channel is telemetry nobody can be
    shown — failing closed is the only answer that does not invent a reader.

    404 with the string an absent row gets, for the reason `assert_owner` states:
    a distinguishable refusal moves the enumeration oracle into the payload. It
    is also the right answer for the create-only refusal: "there is already a row
    there" would confirm an id the caller guessed.
    """
    if not tenancy_enforced():
        return

    model, _ = LOG_MODELS[log_type]
    visible = _visible_channel_names_exact(session, user_id=user_id)
    detail = f"{log_type} log not found"

    for item in body:
        normalized = normalize_body(item)
        log_id = normalized.get("id")
        if log_id and session.get(model, log_id) is not None:
            raise HTTPException(status_code=404, detail=detail)
        if str(normalized.get("channel_name") or "") not in visible:
            raise HTTPException(status_code=404, detail=detail)


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

    **A follow-scoped type checks the Follow instead of the owner**, because
    `assert_owner` on an ownerless row does not merely stop working: `owner_id
    is None` raises, so leaving it here would refuse every sync log write the
    moment ticket 21 flips the flag. Ticket 19 keeps ticket 18's fix by
    restating it in the new vocabulary rather than dropping it.
    """
    model, _ = LOG_MODELS[log_type]
    if scope_of(model) is Scope.FOLLOW_SCOPED:
        _assert_may_write_channel_telemetry(
            session, body, log_type=log_type, user_id=user_id
        )
    else:
        for item in body:
            log_id = normalize_body(item).get("id")
            if not log_id:
                continue
            existing = session.get(model, log_id)
            if existing is not None:
                assert_owner_on_write(
                    getattr(existing, "user_id", None),
                    user_id,
                    detail=f"{log_type} log not found",
                )

    # Sync logs are out of this table rather than in it with a signature that
    # lies. They store no owner at all (ticket 19), so ticket 22 dropped the
    # column and the `user_id` parameter together; the four that remain all take
    # an owner and genuinely write it, which is what lets them share a type.
    owner_upserts: dict[str, Callable[[Session, dict[str, Any], uuid.UUID], None]] = {
        "publish": upsert_publish_log,
        "llm": upsert_llm_log,
        "embedding": upsert_embedding_log,
        "network": upsert_network_log,
    }
    resource = LOG_MODELS[log_type][1]
    for item in body:
        if log_type == "sync":
            upsert_sync_log(session, item)
        else:
            owner_upserts[log_type](session, item, user_id)
    session.commit()
    from app.services.sync_meta import touch_sync

    touch_sync(session, resource)
    return {"upserted": len(body)}
