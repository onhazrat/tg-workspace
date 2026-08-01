"""The five log resources and the retention purge.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import CurrentUser, SessionDep
from app.schemas.logs import (
    EmbeddingLogResponse,
    LLMLogResponse,
    LogWriteResponse,
    NetworkLogResponse,
    PublishLogResponse,
    PurgeLogsResponse,
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
    list_embedding_logs,
    list_llm_logs,
    list_network_logs,
    list_publish_logs,
    list_sync_logs,
)
from app.services.sync_meta import touch_sync

router = APIRouter()


@router.get("/publish-logs")
def list_publish_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_LOG_PAGE_SIZE, ge=1, le=MAX_LOG_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[PublishLogResponse]:
    return [
        PublishLogResponse.model_validate(row)
        for row in list_publish_logs(session, limit=limit, offset=offset)
    ]


@router.post("/publish-logs")
def create_publish_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> LogWriteResponse:
    return LogWriteResponse.model_validate(
        create_logs(session, "publish", body, user_id=_current_user.id)
    )


@router.get("/sync-logs")
def list_sync_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_LOG_PAGE_SIZE, ge=1, le=MAX_LOG_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[SyncLogResponse]:
    return [
        SyncLogResponse.model_validate(row)
        for row in list_sync_logs(session, limit=limit, offset=offset)
    ]


@router.post("/sync-logs")
def create_sync_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> LogWriteResponse:
    return LogWriteResponse.model_validate(
        create_logs(session, "sync", body, user_id=_current_user.id)
    )


@router.get("/llm-logs")
def list_llm_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_LOG_PAGE_SIZE, ge=1, le=MAX_LOG_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[LLMLogResponse]:
    return [
        LLMLogResponse.model_validate(row)
        for row in list_llm_logs(session, limit=limit, offset=offset)
    ]


@router.post("/llm-logs")
def create_llm_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> LogWriteResponse:
    return LogWriteResponse.model_validate(
        create_logs(session, "llm", body, user_id=_current_user.id)
    )


@router.get("/embedding-logs")
def list_embedding_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_LOG_PAGE_SIZE, ge=1, le=MAX_LOG_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[EmbeddingLogResponse]:
    return [
        EmbeddingLogResponse.model_validate(row)
        for row in list_embedding_logs(session, limit=limit, offset=offset)
    ]


@router.post("/embedding-logs")
def create_embedding_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> LogWriteResponse:
    return LogWriteResponse.model_validate(
        create_logs(session, "embedding", body, user_id=_current_user.id)
    )


@router.get("/network-logs")
def list_network_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = Query(default=DEFAULT_LOG_PAGE_SIZE, ge=1, le=MAX_LOG_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> list[NetworkLogResponse]:
    return [
        NetworkLogResponse.model_validate(row)
        for row in list_network_logs(session, limit=limit, offset=offset)
    ]


@router.post("/network-logs")
def create_network_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> LogWriteResponse:
    return LogWriteResponse.model_validate(
        create_logs(session, "network", body, user_id=_current_user.id)
    )


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
    if log_type not in LOG_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown log type: {log_type}")

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
