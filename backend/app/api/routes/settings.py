"""The Settings page: the registry and its one write door (SET-02, ADR-032).

`GET /settings/registry` lists every Setting the caller may see. `PUT
/settings/{setting_id}` changes or resets one, validated against its
declaration and written through the settings aggregate that owns its key. The
section routes under `/data/settings` stay for `SettingsContext` until it is
rebuilt on the registry.

A View-as session reads the target's page, and its writes are refused by
`get_current_user` like every other write until the session is elevated.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser, SessionDep
from app.jobs.settings import write_setting_field
from app.schemas.settings_registry import (
    SettingRow,
    SettingsRegistryResponse,
    SettingWriteRequest,
)
from app.services import rbac, settings_page
from app.services.setting_declarations import declaration
from app.services.sync_meta import touch_sync

router = APIRouter(prefix="/settings", tags=["settings"])

#: The 404 for an id nobody declared and for one the caller may not see alike,
#: so a refusal does not say which infrastructure Settings exist.
NO_SUCH_SETTING = "No such Setting"


@router.get("/registry", response_model=SettingsRegistryResponse)
def read_settings_registry(
    session: SessionDep, current_user: CurrentUser
) -> SettingsRegistryResponse:
    return settings_page.build_registry(session, current_user.id)


@router.put("/{setting_id}", response_model=SettingRow)
def update_setting(
    setting_id: str,
    body: SettingWriteRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> SettingRow:
    decl = declaration(setting_id)
    permissions = rbac.permissions_for(session, current_user.id)
    if decl is None or not settings_page.is_visible(decl, permissions):
        raise HTTPException(status_code=404, detail=NO_SUCH_SETTING)
    if decl.scope == "browser":
        raise HTTPException(
            status_code=422, detail="Kept in this browser; the page stores it there."
        )
    lock = settings_page.lock_reason(decl, permissions)
    if lock is not None:
        raise HTTPException(status_code=403, detail=lock)
    value = body.value
    if not body.reset:
        refusal = settings_page.write_refusal(session, decl, value)
        if refusal is not None:
            raise HTTPException(status_code=422, detail=refusal)
        if decl.type == "integer" and isinstance(value, float):
            value = int(value)
    write_setting_field(
        session,
        decl.key,
        decl.field,
        value,
        reset=body.reset,
        user_id=current_user.id,
    )
    touch_sync(session, "settings")
    return settings_page.row_for(session, current_user.id, decl)
