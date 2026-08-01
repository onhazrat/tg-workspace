"""Database statistics, table clears, settings rows, import and export.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser, SessionDep
from app.jobs.settings import (
    load_jobs_settings,
    load_retention_settings,
    load_sync_settings,
    load_translation_settings,
)
from app.models_tg import AppSetting, utc_now
from app.schemas.stats import (
    ClearTableResponse,
    DbStatsResponse,
    TableSizeResponse,
)
from app.services.data_import_export import import_data as import_data_impl
from app.services.data_import_export import stream_export_data
from app.services.network_settings import (
    get_network_setting_row,
    merge_network_put,
    network_settings_payload,
)
from app.services.settings_store import get_app_setting, put_app_setting
from app.services.stats import clear_table, get_db_stats, get_table_sizes
from app.services.sync_meta import touch_sync

_SETTING_LOADERS = {
    "jobs": load_jobs_settings,
    "sync": load_sync_settings,
    "retention": load_retention_settings,
    "translation": load_translation_settings,
}
# Tables whose clear removes rows from more than one resource.
CLEARED_SYNC_RESOURCES: dict[str, tuple[str, ...]] = {
    "posts": ("posts", "embeddings", "translations"),
}


router = APIRouter()


@router.get("/stats")
def db_stats(
    session: SessionDep,
    _current_user: CurrentUser,
) -> DbStatsResponse:
    return DbStatsResponse.model_validate(
        get_db_stats(session, operator_id=_current_user.id)
    )


@router.get("/table-sizes")
def table_sizes(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[TableSizeResponse]:
    return [
        TableSizeResponse.model_validate(row)
        for row in get_table_sizes(session, operator_id=_current_user.id)
    ]


@router.delete("/tables/{name}")
def clear_table_route(
    name: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> ClearTableResponse:
    try:
        deleted = clear_table(session, name, operator_id=_current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if deleted:
        # Clearing posts cascades (see clear_table), so refresh the etags of
        # the dependent resources too or their caches would serve rows the
        # database no longer has.
        for resource in CLEARED_SYNC_RESOURCES.get(name, (name,)):
            touch_sync(session, resource)
    return ClearTableResponse(deleted=deleted)


@router.get("/settings/network")
def get_network_settings(
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    row = get_network_setting_row(session)
    value = network_settings_payload(
        row.value if row else None,
        owner_user_id=row.user_id if row else _current_user.id,
    )
    return {"key": "network", "value": value}


@router.put("/settings/network")
def put_network_settings(
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    row = get_network_setting_row(session)
    merged = merge_network_put(body, row.value if row else None)
    if row:
        row.value = merged
        row.user_id = _current_user.id
        row.updated_at = utc_now()
    else:
        row = AppSetting(key="network", value=merged, user_id=_current_user.id)
    session.add(row)
    session.commit()
    touch_sync(session, "settings")
    return {
        "key": "network",
        "value": network_settings_payload(merged, owner_user_id=_current_user.id),
    }


@router.get("/settings/{key}")
def get_setting(
    key: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    loader = _SETTING_LOADERS.get(key)
    if loader is not None:
        return {"key": key, "value": loader(session)}
    return get_app_setting(session, key)


@router.put("/settings/{key}")
def put_setting(
    key: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    result = put_app_setting(session, key, body, user_id=_current_user.id)
    touch_sync(session, "settings")
    return result


@router.post("/import")
def import_data(
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return import_data_impl(session, body, user_id=_current_user.id)


@router.get("/export")
def export_data(
    session: SessionDep,
    _current_user: CurrentUser,
) -> StreamingResponse:
    """Full export — never truncated.

    Streamed rather than built in memory: the payload spans every post and log
    row, which is far more than a worker can hold at once.
    """
    return StreamingResponse(
        stream_export_data(session),
        media_type="application/json",
    )
