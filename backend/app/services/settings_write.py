"""Orchestrator: the Settings page's one write door (SET-02, ADR-032).

`PUT /settings/{setting_id}` decides here what may be written and how:
Configuration is refused with its lock, an undeclared or hidden id is one
404, a browser Setting is the page's own business, a locked one answers its
lock reason, and a value is checked against its declaration before the
settings aggregate that owns the key stores it. The etag moves in the same
commit as the write.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException
from pydantic import JsonValue
from sqlmodel import Session

from app.core.permissions import Permission
from app.core.request_recording import RequestKind
from app.jobs.settings import load_reach_settings, write_setting_field
from app.schemas.settings_registry import SettingRow
from app.services import rbac
from app.services.reach import reach_settings_from
from app.services.request_kinds import record_switch_time
from app.services.setting_declarations import Declaration, declaration
from app.services.settings_configuration import configuration_lock
from app.services.settings_page import is_visible, lock_reason, row_for
from app.services.settings_registry import REACH_KEY, REQUEST_KINDS_KEY
from app.services.sync_meta import touch_sync

#: The 404 for an id nobody declared and for one the caller may not see alike,
#: so a refusal does not say which infrastructure Settings exist.
NO_SUCH_SETTING = "No such Setting"
KEPT_IN_BROWSER = "Kept in this browser; the page stores it there."


def _type_refusal(decl: Declaration, value: Any) -> str | None:
    if value is None:
        return None if decl.nullable else f"{decl.title} needs a value."
    is_number = isinstance(value, (int, float)) and not isinstance(value, bool)
    checks: dict[str, bool] = {
        "boolean": isinstance(value, bool),
        "integer": is_number and float(value).is_integer(),
        "number": is_number,
        "string": isinstance(value, str),
        "enum": value in {v for v, _ in decl.options},
        "json": True,
    }
    if not checks[decl.type]:
        if decl.type == "enum":
            return f"{decl.title} is one of {', '.join(v for v, _ in decl.options)}."
        return f"{decl.title} must be a {decl.type}."
    if is_number and decl.min is not None and value < decl.min:
        return f"{decl.title} is at least {decl.min:g}."
    if is_number and decl.max is not None and value > decl.max:
        return f"{decl.title} is at most {decl.max:g}."
    return None


def write_refusal(session: Session, decl: Declaration, value: Any) -> str | None:
    """Why `value` cannot be stored for `decl`, in words the row can show."""
    refusal = _type_refusal(decl, value)
    if refusal is not None or decl.key != REACH_KEY:
        return refusal
    # The Reach settings are validated together, against what is stored.
    try:
        reach_settings_from({**load_reach_settings(session), decl.field: value})
    except ValueError as exc:
        return str(exc)
    return None


def update_setting(
    session: Session,
    user_id: uuid.UUID,
    setting_id: str,
    value: JsonValue,
    *,
    reset: bool,
) -> SettingRow:
    """Change or reset one Setting for `user_id`, or raise the refusal."""
    decl = declaration(setting_id)
    permissions = rbac.permissions_for(session, user_id)
    if decl is None and Permission.SETTINGS_MANAGE in permissions:
        lock = configuration_lock(setting_id)
        if lock is not None:
            raise HTTPException(status_code=403, detail=lock)
    if decl is None or not is_visible(decl, permissions):
        raise HTTPException(status_code=404, detail=NO_SUCH_SETTING)
    if decl.scope == "browser":
        raise HTTPException(status_code=422, detail=KEPT_IN_BROWSER)
    lock = lock_reason(decl, permissions)
    if lock is not None:
        raise HTTPException(status_code=403, detail=lock)
    if not reset:
        refusal = write_refusal(session, decl, value)
        if refusal is not None:
            raise HTTPException(status_code=422, detail=refusal)
        if decl.type == "integer" and isinstance(value, float):
            value = int(value)
    # Staged first so the write's own commit carries it (sync_meta.touch_sync).
    touch_sync(session, "settings", commit=False)
    write_setting_field(
        session, decl.key, decl.field, value, reset=reset, user_id=user_id
    )
    if decl.key == REQUEST_KINDS_KEY:
        record_switch_time(session, RequestKind(decl.field))
    return row_for(session, user_id, decl)
