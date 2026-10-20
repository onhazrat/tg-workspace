"""Read model: the Settings page for one Account (SET-02, ADR-032).

Builds every row `setting_declarations.DECLARATIONS` says the caller may see,
with its value, its resolved default and whether the caller may change it. It
writes nothing: `jobs/settings.write_setting_field` routes a write to the
settings aggregate that owns the key.

**A default is what a reset returns the row to**, so it is resolved, never
restated: the loader defaults the rest of the app already merges under stored
values, then the `.env` value a declaration names, then the declaration's own
literal (the Tor fields, whose only default used to be the browser's).

One request reads each settings key once, whatever the number of rows: the
registry has ~90 of them and a per-row read would be the "compute it for
everything" shape this repo has fixed twice.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from sqlmodel import Session

from app.core.config import settings
from app.core.permissions import Permission
from app.jobs.settings import (
    _default_directory,
    _default_jobs,
    _default_media,
    _default_retention_policy,
    _default_retention_prefs,
    _default_sync,
    _default_translation,
    default_ai_prefs,
    load_directory_settings,
    load_jobs_settings,
    load_media_settings,
    load_reach_settings,
    load_retention_settings,
    load_sync_settings,
    load_translation_settings,
)
from app.schemas.settings_registry import (
    SettingOption,
    SettingRow,
    SettingsRegistryResponse,
    SettingTopic,
)
from app.services import rbac
from app.services.publication_parts import PublishingSettings
from app.services.reach import (
    DEFAULT_REACH_SETTINGS,
    REACH_SETTING_FIELDS,
)
from app.services.setting_declarations import (
    DECLARATIONS,
    TOPICS,
    Declaration,
)
from app.services.settings_configuration import configuration_rows
from app.services.settings_registry import (
    AI_PREFS_KEY,
    DIRECTORY_KEY,
    PUBLISHING_KEY,
    REACH_KEY,
    RETENTION_KEY,
    RETENTION_PREFS_KEY,
    SYNC_KEY,
    SYNC_PREFS_KEY,
    Home,
    home_for,
)
from app.services.settings_store import get_global_setting
from app.services.user_settings import get_user_setting

#: The lock an Account without `settings:manage` reads on a deployment Setting.
SET_BY_OPERATOR = "Set by the Operator"

_MISSING = object()


def _default_publishing() -> dict[str, Any]:
    defaults = PublishingSettings()
    return {
        "citationStyle": defaults.citation_style,
        "linkPreviews": defaults.link_previews,
        "timeZone": defaults.time_zone,
    }


def _default_reach() -> dict[str, Any]:
    return {
        wire: getattr(DEFAULT_REACH_SETTINGS, attr)
        for wire, attr in REACH_SETTING_FIELDS.items()
    }


#: What each key's loader merges stored values over. A key absent here
#: (`network`, `quota`) has no loader default; its declarations name one.
LOADER_DEFAULTS: dict[str, Callable[[], dict[str, Any]]] = {
    "jobs": _default_jobs,
    SYNC_KEY: _default_sync,
    SYNC_PREFS_KEY: _default_sync,
    RETENTION_KEY: _default_retention_policy,
    RETENTION_PREFS_KEY: _default_retention_prefs,
    "media": _default_media,
    "translation": _default_translation,
    DIRECTORY_KEY: _default_directory,
    REACH_KEY: _default_reach,
    PUBLISHING_KEY: _default_publishing,
    AI_PREFS_KEY: default_ai_prefs,
}


def _effective(session: Session, key: str, user_id: uuid.UUID) -> dict[str, Any]:
    """The section as the app reads it: stored values over the loader defaults."""
    if key == "jobs":
        return load_jobs_settings(session)
    if key in (SYNC_KEY, SYNC_PREFS_KEY):
        return load_sync_settings(session, user_id=user_id)
    if key in (RETENTION_KEY, RETENTION_PREFS_KEY):
        return load_retention_settings(session, user_id=user_id)
    if key == "media":
        return load_media_settings(session)
    if key == "translation":
        return load_translation_settings(session)
    if key == DIRECTORY_KEY:
        return load_directory_settings(session)
    if key == REACH_KEY:
        return load_reach_settings(session)
    if home_for(key) is Home.USER:
        stored = get_user_setting(session, key, user_id=user_id)
    else:
        stored = get_global_setting(session, key)
    return {**LOADER_DEFAULTS.get(key, dict)(), **stored}


def _get(section: dict[str, Any], path: str) -> Any:
    value: Any = section
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return _MISSING
        value = value[part]
    return value


def resolve_default(decl: Declaration) -> Any:
    """What `decl` resets to: the loader's default, the `.env` seed, or its literal."""
    if decl.scope == "browser":
        return None
    loader = LOADER_DEFAULTS.get(decl.key)
    if loader is not None:
        value = _get(loader(), decl.field)
        if value is not _MISSING:
            return value
    if decl.env is not None:
        return getattr(settings, decl.env)
    return decl.default


def is_visible(decl: Declaration, permissions: frozenset[Permission]) -> bool:
    return decl.visible == "everyone" or Permission.SETTINGS_MANAGE in permissions


def lock_reason(decl: Declaration, permissions: frozenset[Permission]) -> str | None:
    """Why the caller cannot change `decl`, or `None` when they can."""
    if decl.lock is not None:
        return decl.lock
    if decl.scope == "deployment" and Permission.SETTINGS_MANAGE not in permissions:
        return SET_BY_OPERATOR
    return None


def _storage(decl: Declaration) -> str:
    if decl.scope == "browser":
        return f"This browser: {decl.key}"
    table = "tg_user_settings" if decl.scope == "account" else "tg_app_settings"
    return f"{table}.{decl.key}.{decl.field}"


def _row(
    decl: Declaration, section: dict[str, Any], permissions: frozenset[Permission]
) -> SettingRow:
    default = resolve_default(decl)
    if decl.scope == "browser":
        value: Any = None
    else:
        value = _get(section, decl.field)
        if value is _MISSING or (value is None and not decl.nullable):
            value = default
    lock = lock_reason(decl, permissions)
    return SettingRow(
        id=decl.id,
        title=decl.title,
        description=decl.description,
        topic=decl.topic,
        scope=decl.scope,
        type=decl.type,
        options=[SettingOption(value=v, label=label) for v, label in decl.options],
        min=decl.min,
        max=decl.max,
        value=value,
        default=default,
        defaultSource="env" if decl.env else "code",
        modified=decl.scope != "browser" and value != default,
        canEdit=lock is None,
        lockReason=lock,
        storage=_storage(decl),
        key=decl.key,
        field=None if decl.scope == "browser" else decl.field,
    )


def build_registry(session: Session, user_id: uuid.UUID) -> SettingsRegistryResponse:
    """Every row `user_id` may see, each key read once."""
    permissions = rbac.permissions_for(session, user_id)
    sections: dict[str, dict[str, Any]] = {}
    rows: list[SettingRow] = []
    for decl in DECLARATIONS:
        if not is_visible(decl, permissions):
            continue
        if decl.scope != "browser" and decl.key not in sections:
            sections[decl.key] = _effective(session, decl.key, user_id)
        rows.append(_row(decl, sections.get(decl.key, {}), permissions))
    if Permission.SETTINGS_MANAGE in permissions:
        rows.extend(configuration_rows())
    return SettingsRegistryResponse(
        topics=[SettingTopic(id=tid, title=title) for tid, title in TOPICS],
        rows=rows,
        permissions=sorted(p.value for p in permissions),
    )


def row_for(session: Session, user_id: uuid.UUID, decl: Declaration) -> SettingRow:
    """One row, as `build_registry` would answer it."""
    permissions = rbac.permissions_for(session, user_id)
    section = {} if decl.scope == "browser" else _effective(session, decl.key, user_id)
    return _row(decl, section, permissions)
