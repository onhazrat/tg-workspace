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

from fastapi import APIRouter, HTTPException, Path, Query

from app.api.deps import CurrentUser, SessionDep
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
    DEFAULT_LOG_PAGE_SIZE,
    LOG_MODELS,
    MAX_LOG_PAGE_SIZE,
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


@router.get("/logs/{log_type}")
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
        limit=limit,
        offset=offset,
        search=search,
        search_in_details=search_in_details,
    )
    return [LOG_LIST_RESPONSES[log_type].model_validate(row) for row in rows]


@router.get("/logs/{log_type}/{log_id}")
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
    row = get_log(session, _known(log_type), log_id)
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
    _current_user: CurrentUser,
    older_than_days: int | None = Query(default=None, alias="olderThanDays"),
    log_type: str | None = Query(default=None, alias="type"),
    log_id: str | None = Query(default=None, alias="logId"),
    clear_all: bool = Query(default=False, alias="clearAll"),
) -> PurgeLogsResponse:
    if older_than_days is not None and older_than_days > 0:
        deleted = delete_old_logs(
            session, older_than_days, operator_id=_current_user.id
        )
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
        if not delete_log_by_id(session, log_type, log_id):
            raise HTTPException(status_code=404, detail="Log entry not found")
        touch_sync(session, resource)
        return PurgeLogsResponse(deleted=1)

    if clear_all:
        count = clear_logs(session, log_type)
        if count:
            touch_sync(session, resource)
        return PurgeLogsResponse(deleted=count)

    raise HTTPException(
        status_code=400,
        detail="Provide logId or clearAll=true with type",
    )
