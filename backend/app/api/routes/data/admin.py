"""Database statistics, table clears, settings rows, import and export.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

import uuid
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.jobs.settings import (
    load_jobs_settings,
    load_retention_settings,
    load_sync_settings,
    load_translation_settings,
    save_sync_settings,
)
from app.schemas.common import AppSettingResponse, ImportDataResponse
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
from app.services.settings_registry import SYNC_KEY, Home, home_for
from app.services.settings_store import (
    get_global_setting,
    put_global_setting,
    replace_global_setting,
)
from app.services.stats import clear_table, get_db_stats, get_table_sizes
from app.services.sync_meta import touch_sync
from app.services.user_settings import get_user_setting, put_user_setting

#: Keys whose GET returns defaults merged over the stored row rather than the
#: bare row. Each takes the caller's id even when it ignores it, so the call
#: site does not have to know which keys have a per-User half — after ticket 06
#: `sync` does and the other three do not.
_SETTING_LOADERS: dict[str, Callable[[Session, uuid.UUID], dict[str, Any]]] = {
    "jobs": lambda session, _user_id: load_jobs_settings(session),
    "sync": lambda session, user_id: load_sync_settings(session, user_id=user_id),
    "retention": lambda session, _user_id: load_retention_settings(session),
    "translation": lambda session, _user_id: load_translation_settings(session),
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
) -> AppSettingResponse:
    row = get_network_setting_row(session)
    value = network_settings_payload(
        row.value if row else None,
        owner_user_id=row.user_id if row else _current_user.id,
    )
    return AppSettingResponse.model_validate({"key": "network", "value": value})


@router.put("/settings/network")
def put_network_settings(
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> AppSettingResponse:
    row = get_network_setting_row(session)
    merged = merge_network_put(body, row.value if row else None)
    # Replace rather than merge: `merge_network_put` has already merged with the
    # rules that understand proxy lists and Tor modes, so a second blind merge
    # in the store would resurrect proxy URLs the operator just removed.
    replace_global_setting(session, "network", merged, user_id=_current_user.id)
    touch_sync(session, "settings")
    return AppSettingResponse.model_validate(
        {
            "key": "network",
            "value": network_settings_payload(merged, owner_user_id=_current_user.id),
        }
    )


@router.get("/settings/{key}")
def get_setting(
    key: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> AppSettingResponse:
    loader = _SETTING_LOADERS.get(key)
    if loader is not None:
        return AppSettingResponse(key=key, value=loader(session, _current_user.id))
    if _home_of(key) is Home.USER:
        value = get_user_setting(session, key, user_id=_current_user.id)
    else:
        value = get_global_setting(session, key)
    return AppSettingResponse(key=key, value=value)


def _home_of(key: str) -> Home:
    """`home_for`, but a 400 instead of a `KeyError` escaping as a 500.

    Before ticket 06 any key was accepted and an unknown one read back as an
    empty value. Now a key has to be classified to be routed at all, so the
    honest answer is to say so — a request naming a key the registry does not
    know is a client mistake, not a server one.
    """
    try:
        return home_for(key)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc.args[0])) from exc


@router.put("/settings/{key}")
def put_setting(
    key: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> AppSettingResponse:
    if key == SYNC_KEY:
        # The three-row carve is invisible from here: the body arrives in the
        # old blob shape and `save_sync_settings` routes each field to the table
        # that owns it, so the response is still the whole reassembled blob.
        save_sync_settings(session, body, user_id=_current_user.id)
        value = load_sync_settings(session, user_id=_current_user.id)
    elif _home_of(key) is Home.USER:
        value = put_user_setting(session, key, body, user_id=_current_user.id)
    else:
        value = put_global_setting(session, key, body, user_id=_current_user.id)
    touch_sync(session, "settings")
    return AppSettingResponse(key=key, value=value)


@router.post("/import")
def import_data(
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> ImportDataResponse:
    return ImportDataResponse.model_validate(
        import_data_impl(session, body, user_id=_current_user.id)
    )


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
