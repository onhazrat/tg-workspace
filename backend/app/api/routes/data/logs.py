"""The five log resources and the retention purge.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.

## One resource, five tables (D1)

`GET /logs/{log_type}` and `POST /logs/{log_type}` serve all five kinds. The
five tables stay — a publish log records a destination, a network log records a
proxy, and flattening them into one table with mostly-null columns would be a
worse database. **The genericity is in the handling, not the storage.**

The ten original per-type paths (`/publish-logs`, `/sync-logs`, …) existed as
deprecated aliases between D1 and D2 so the frontend could migrate
independently. **D2 removed them** — `/logs/{log_type}` is now the only way in.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from app.api.deps import CurrentUser, SessionDep, require_permission
from app.core.permissions import Permission
from app.schemas.logs import (
    EmbeddingLogResponse,
    LLMLogListItemResponse,
    LLMLogResponse,
    LogDetailResponse,
    LogEntryResponse,
    LogWriteResponse,
    NetworkLogResponse,
    PublishLogListItemResponse,
    PublishLogResponse,
    PurgeLogsResponse,
    SyncLogListItemResponse,
    SyncLogResponse,
)
from app.services.logs import (
    ADMIN_ONLY_LOG_TYPES,
    DEFAULT_LOG_PAGE_SIZE,
    LOG_MODELS,
    MAX_LOG_PAGE_SIZE,
    SHARED_LOG_TYPES,
    clear_logs,
    create_logs,
    delete_log_by_id,
    delete_old_logs,
    get_log,
    list_logs,
)
from app.services.sync_meta import touch_sync

router = APIRouter()

#: Path-parameter constraint. Declaring the five valid values here means an
#: unknown type is a 422 from FastAPI before the handler runs, and OpenAPI
#: documents the enum rather than leaving `log_type` an opaque string.
LogType = Path(description="publish | sync | llm | embedding | network")


def _known(log_type: str) -> str:
    if log_type not in LOG_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown log type: {log_type}")
    return log_type


def require_readable_log_type(
    session: SessionDep,
    current_user: CurrentUser,
    log_type: str = LogType,
) -> None:
    """Admin-only for the log types no account owns; open for the rest.

    Network logs record what the deployment's proxies did, so there is no
    account whose rows they are — decision 23 makes them Admin-only and keeps a
    nullable owner for whoever triggered the request. The other four types are
    things an account produced, and taking them away from the person who
    produced them is not what ticket 18 asks for; the tenancy seam narrows those
    to the caller's own rows instead.

    The check is here rather than in `dependencies=` on the router because the
    type is a *path parameter*: one handler serves five kinds, and only one of
    them is administrative. `require_permission` is an ordinary callable, so
    this composes it rather than reimplementing the refusal — which matters,
    because the refusal text is asserted in three places and a second spelling
    of it would be a second answer to "why were you refused".

    **Reads only.** The first cut of ticket 18 put this on the write too, on the
    tidy-sounding argument that an account which may not read the proxy log has
    no business writing to it. Six frontend flows write network telemetry —
    adding a channel, refreshing metadata, testing a proxy, the Tor panel and
    actions, bot management — and `writeLog` swallows a failure with a
    `console.warn` by design, so gating the write does not refuse anything
    visibly. It just stops recording a non-Admin's telemetry, with nothing
    anywhere saying so. A write stamps its author; the Admin still reads them
    all, which is what decision 23 actually asks for.
    """
    if log_type in ADMIN_ONLY_LOG_TYPES:
        require_permission(Permission.LOGS_READ_ANY)(session, current_user)


#: The gate on the two deployment-wide purge branches. **Not on the route**: the
#: same endpoint also deletes a single row by id, which is how every Logs tab
#: removes one of the caller's own entries. Gating the route made that an error
#: toast for anyone who is not an Admin, which is a regression dressed as a
#: security fix — one row of your own is not an administrative act.
ADMIN_ONLY = require_permission(Permission.DATA_ADMIN)

#: The per-type gate, for the two read routes that name a `log_type`.
READABLE_LOG_TYPE = [Depends(require_readable_log_type)]


@router.get("/logs/{log_type}", dependencies=READABLE_LOG_TYPE)
def list_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
    log_type: str = LogType,
    limit: int = Query(default=DEFAULT_LOG_PAGE_SIZE, ge=1, le=MAX_LOG_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None),
    search_in_details: bool = Query(default=False, alias="searchInDetails"),
) -> list[LogEntryResponse]:
    """One newest-first page of any log type, without the corpus-sized fields.

    Paged rather than whole-table: these tables carry request/response JSON and
    grow without bound between retention sweeps, so an unfiltered select can
    materialise gigabytes and OOM the worker. Full data ships via the export
    path, which streams.

    The bodies are on `GET /logs/{log_type}/{log_id}` — this page was 56.28 MB
    for 500 rows, 99.7% of it bodies the viewer only renders for an expanded
    row. `search` runs in SQL so they stay findable without being sent, and
    `searchInDetails` extends the match into them; both now search the whole
    table rather than the page that happened to be fetched.
    """
    rows = list_logs(
        session,
        _known(log_type),
        user_id=_current_user.id,
        limit=limit,
        offset=offset,
        search=search,
        search_in_details=search_in_details,
    )
    return [LOG_LIST_RESPONSES[log_type].model_validate(row) for row in rows]


@router.get("/logs/{log_type}/{log_id}", dependencies=READABLE_LOG_TYPE)
def get_log_route(
    session: SessionDep,
    _current_user: CurrentUser,
    log_type: str = LogType,
    log_id: str = Path(description="The log row's id"),
) -> LogDetailResponse:
    """One log row in full, bodies included.

    The other half of the list projection. `GET /data/logs/sync` shipped
    56.28 MB for a page of 500 rows, 99.7% of it request/response bodies that
    the viewer renders only for an expanded row — and it expands one at a time.
    This serves that one row.
    """
    row = get_log(session, _known(log_type), log_id, user_id=_current_user.id)
    return LOG_RESPONSES[log_type].model_validate(row)


@router.post("/logs/{log_type}")
def create_logs_route(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
    log_type: str = LogType,
) -> LogWriteResponse:
    """Upsert a batch of log rows of one type."""
    return LogWriteResponse.model_validate(
        create_logs(session, _known(log_type), body, user_id=_current_user.id)
    )


#: `log_type` -> **detail** response model, used to pick the right member of the
#: `LogDetailResponse` union. The list route uses `LOG_LIST_SCHEMAS` instead. Declared next to the routes because it is a
#: presentation concern; `app/schemas/logs.py::LOG_SCHEMAS` is the same mapping
#: for callers that need it without importing the router.
LOG_RESPONSES: dict[str, type[LogDetailResponse]] = {
    "publish": PublishLogResponse,
    "sync": SyncLogResponse,
    "llm": LLMLogResponse,
    "embedding": EmbeddingLogResponse,
    "network": NetworkLogResponse,
}

#: `log_type` -> the model a *list* page validates against. Embedding and
#: network appear in both tables because they have no heavy column to drop.
#: `app/schemas/logs.py::LOG_LIST_SCHEMAS` is the same mapping for callers that
#: need it without importing the router.
LOG_LIST_RESPONSES: dict[str, type[LogEntryResponse]] = {
    "publish": PublishLogListItemResponse,
    "sync": SyncLogListItemResponse,
    "llm": LLMLogListItemResponse,
    "embedding": EmbeddingLogResponse,
    "network": NetworkLogResponse,
}


@router.delete("/logs")
def purge_logs(
    session: SessionDep,
    current_user: CurrentUser,
    older_than_days: int | None = Query(default=None, alias="olderThanDays"),
    log_type: str | None = Query(default=None, alias="type"),
    log_id: str | None = Query(default=None, alias="logId"),
    clear_all: bool = Query(default=False, alias="clearAll"),
) -> PurgeLogsResponse:
    """Three deletes behind one endpoint, and they are not the same act.

    `olderThanDays` and `clearAll` sweep across every account, so both demand
    `DATA_ADMIN`. `logId` removes exactly one row, which is what the delete
    button on each of the five Logs tabs calls, for everybody — gating the whole
    route turned that into an error toast for any non-Admin, so the gate is per
    branch. The single-row branch answers to the owner instead.

    `SHARED_LOG_TYPES` is the exception, and it is derived from the tenancy
    classification rather than listed here: for a type nobody owns a row of,
    there is no owner for `get_log` to answer to, so the single-row delete is an
    administrative act like the two sweeps. That covers sync logs from ticket 19
    and network logs, which have been deletable one row at a time by any
    authenticated account since the Admin gate went on their *reads* alone.
    """
    if older_than_days is not None and older_than_days > 0:
        ADMIN_ONLY(session, current_user)
        deleted = delete_old_logs(session, older_than_days, operator_id=current_user.id)
        for resource in {LOG_MODELS[k][1] for k in deleted if deleted[k]}:
            touch_sync(session, resource)
        return PurgeLogsResponse.model_validate(
            {"deleted": deleted, "total": sum(deleted.values())}
        )

    if log_type is None:
        raise HTTPException(
            status_code=400,
            detail="Provide olderThanDays, or type with logId/clearAll",
        )
    _known(log_type)

    resource = LOG_MODELS[log_type][1]
    if log_id:
        # Owner-checked, not Admin-gated, and checked *before* the delete: the
        # alternative is removing someone else's row and then reporting that it
        # could not be found. `get_log` raises the 404 that a foreign or absent
        # row both get, with the detail that family already uses.
        #
        # **Except for the shared types, which are an administrative act.**
        # Ticket 18 left this branch ungated because "one row of your own is not
        # an administrative act". Ticket 19 makes a sync log channel telemetry
        # visible to every Follower, and that sentence then points the other
        # way: the row is nobody's own, so a Follower deleting it destroys the
        # record for everyone else watching the Channel. That is what ticket
        # 20's own checkbox forbids, and the same argument ticket 05 made for
        # unfollowing a Channel rather than deleting it.
        if log_type in SHARED_LOG_TYPES:
            ADMIN_ONLY(session, current_user)
        get_log(session, log_type, log_id, user_id=current_user.id)
        if not delete_log_by_id(session, log_type, log_id):
            raise HTTPException(status_code=404, detail="Log entry not found")
        touch_sync(session, resource)
        return PurgeLogsResponse(deleted=1)

    if clear_all:
        ADMIN_ONLY(session, current_user)
        count = clear_logs(session, log_type)
        if count:
            touch_sync(session, resource)
        return PurgeLogsResponse(deleted=count)

    raise HTTPException(
        status_code=400,
        detail="Provide logId or clearAll=true with type",
    )
