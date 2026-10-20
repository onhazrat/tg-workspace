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

from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.schemas.settings_registry import (
    SettingRow,
    SettingsRegistryResponse,
    SettingWriteRequest,
)
from app.services import settings_page, settings_write

router = APIRouter(prefix="/settings", tags=["settings"])


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
    return settings_write.update_setting(
        session, current_user.id, setting_id, body.value, reset=body.reset
    )
