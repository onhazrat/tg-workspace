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

import ast
import json
import os
import re
import uuid
from collections import Counter
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import JsonValue
from pydantic_core import PydanticUndefined
from sqlmodel import Session

from app.core.config import SENSITIVE_CONFIG_SUFFIXES, Settings, settings
from app.core.permissions import Permission
from app.jobs.settings import (
    default_ai_prefs,
    _default_directory,
    _default_jobs,
    _default_media,
    _default_retention_policy,
    _default_retention_prefs,
    _default_sync,
    _default_translation,
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
    SettingRowType,
    SettingsRegistryResponse,
    SettingTopic,
)
from app.services import rbac
from app.services.network_settings import redact_proxy_url
from app.services.publication_parts import PublishingSettings
from app.services.reach import (
    DEFAULT_REACH_SETTINGS,
    REACH_SETTING_FIELDS,
    reach_settings_from,
)
from app.services.setting_declarations import (
    CONSTANT_TOPICS,
    DECLARATIONS,
    TOPICS,
    Declaration,
    env_topic,
)
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
    )


# --- Configuration (SET-04) -------------------------------------------------
# What the deployment is tuned by that is not a Setting: every `.env` value the
# backend reads, every frontend build value and every tuning constant. Only a
# holder of `settings:manage` sees any of it, and none of it is writable here.

RESTART_LOCK = "Read at startup: change .env and restart"
REBUILD_LOCK = "Built into the frontend: change .env and rebuild"
DEPLOY_LOCK = "Constant in code: needs a deploy"

_CORE = Path(__file__).resolve().parents[1] / "core"
_CONFIG_SOURCE = _CORE / "config.py"
_ENV_CATALOG = _CORE / "env_catalog.generated.json"
_CONSTANTS_CATALOG = _CORE / "constants_catalog.generated.json"


@lru_cache(maxsize=1)
def constants_catalog() -> tuple[dict[str, Any], ...]:
    """The generated catalog of code constants (`scripts/generate_constants_catalog.py`)."""
    return tuple(json.loads(_CONSTANTS_CATALOG.read_text())["constants"])


@lru_cache(maxsize=1)
def _env_manifest() -> dict[str, dict[str, Any]]:
    variables = json.loads(_ENV_CATALOG.read_text())["variables"]
    return {item["name"]: item for item in variables}


def _comment_above(lines: list[str], lineno: int) -> str:
    out: list[str] = []
    i = lineno - 2
    while i >= 0 and lines[i].strip().startswith("#"):
        out.append(re.sub(r"^#:?\s?", "", lines[i].strip()))
        i -= 1
    return re.sub(r"\s+", " ", " ".join(reversed(out))).strip()


@lru_cache(maxsize=1)
def _settings_source() -> dict[str, tuple[int, str]]:
    """Each `Settings` field's line in `config.py` and the comment above it."""
    source = _CONFIG_SOURCE.read_text()
    lines = source.splitlines()
    cls = next(
        node
        for node in ast.parse(source).body
        if isinstance(node, ast.ClassDef) and node.name == "Settings"
    )
    return {
        node.target.id: (node.lineno, _comment_above(lines, node.lineno))
        for node in cls.body
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
    }


@lru_cache(maxsize=1)
def _dotenv_names() -> frozenset[str]:
    """Names the configured dotenv files assign, without loading their values."""
    configured = Settings.model_config.get("env_file")
    if not configured:
        return frozenset()
    paths = [configured] if isinstance(configured, (str, Path)) else list(configured)
    backend_root = Path(__file__).resolve().parents[2]
    names: set[str] = set()
    for raw in paths:
        path = Path(raw)
        candidates = (
            [path] if path.is_absolute() else [Path.cwd() / path, backend_root / path]
        )
        found = next((c for c in candidates if c.is_file()), None)
        if found is None:
            continue
        for line in found.read_text().splitlines():
            match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
            if match:
                names.add(match.group(1).upper())
    return frozenset(names)


def _camel(name: str) -> str:
    head, *rest = name.lower().strip("_").split("_")
    return head + "".join(part.title() for part in rest)


def _title(name: str) -> str:
    return name.strip("_").replace("_", " ").capitalize()


def _plain(value: Any) -> JsonValue:
    """A value as JSON, with any credential in a URL masked."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return redact_proxy_url(value) or value
    if isinstance(value, (list, tuple, set)):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    return _plain(str(value))


def _type_of(value: Any) -> SettingRowType:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, (list, dict)):
        return "json"
    return "string"


def is_secret(name: str) -> bool:
    return name.endswith(SENSITIVE_CONFIG_SUFFIXES) or bool(
        _env_manifest().get(name, {}).get("sensitive")
    )


def _is_set(value: Any) -> bool:
    return value not in (None, "", [], {})


def _env_row(name: str) -> SettingRow:
    line, comment = _settings_source()[name]
    field = Settings.model_fields[name]
    default = None if field.default is PydanticUndefined else _plain(field.default)
    value = _plain(getattr(settings, name))
    source = (
        "Environment"
        if name in os.environ
        else ".env"
        if name in _dotenv_names()
        else "Code default"
    )
    secret = is_secret(name)
    return SettingRow(
        id=f"{env_topic(name)}.env.{_camel(name)}",
        title=_title(name),
        description=comment,
        topic=env_topic(name),
        scope="env",
        type="string" if secret else _type_of(value if value is not None else default),
        value=("set" if _is_set(value) else "not set") if secret else value,
        default=None if secret else default,
        defaultSource="code",
        modified=not secret and value != default,
        canEdit=False,
        lockReason=RESTART_LOCK,
        applies="restart",
        storage=f"{source}: {name}",
        sensitive=secret,
        envName=name,
        sourceRef=f"backend/app/core/config.py:{line}",
    )


def _build_row(spec: dict[str, Any]) -> SettingRow:
    """A frontend build value; the page fills in what this browser's bundle runs."""
    name = spec["name"]
    secret = is_secret(name)
    default = None if secret else spec.get("default")
    return SettingRow(
        id=f"{env_topic(name)}.env.{_camel(name)}",
        title=_title(name.removeprefix("VITE_")),
        description="Built into the frontend bundle; the value shown is what this browser runs.",
        topic=env_topic(name),
        scope="env",
        type="string" if secret else _type_of(default),
        value=None,
        default=default,
        defaultSource="code",
        modified=False,
        canEdit=False,
        lockReason=REBUILD_LOCK,
        applies="rebuild",
        storage=f"Frontend build: {name}",
        sensitive=secret,
        envName=name,
    )


def _module_name(path: str) -> str:
    return _camel(re.sub(r"(?<=[a-z0-9])(?=[A-Z])|-", "_", Path(path).stem))


def _code_rows() -> list[SettingRow]:
    catalog = constants_catalog()
    ids = [f"{CONSTANT_TOPICS[c['file']]}.code.{_camel(c['name'])}" for c in catalog]
    taken = Counter(ids)
    rows: list[SettingRow] = []
    for constant, base in zip(catalog, ids, strict=True):
        topic = CONSTANT_TOPICS[constant["file"]]
        name = _camel(constant["name"])
        if taken[base] > 1:
            # One name in two modules of a topic: the module tells them apart.
            module = _module_name(constant["file"])
            name = module + name[0].upper() + name[1:]
        expression = constant["expression"]
        written = (
            "" if expression == str(constant["value"]) else f" Written as {expression}."
        )
        ref = f"{constant['file']}:{constant['line']}"
        rows.append(
            SettingRow(
                id=f"{topic}.code.{name}",
                title=_title(constant["name"]),
                description=(constant["comment"] + written).strip(),
                topic=topic,
                scope="code",
                type=_type_of(constant["value"]),
                value=constant["value"],
                default=constant["value"],
                defaultSource="code",
                modified=False,
                canEdit=False,
                lockReason=DEPLOY_LOCK,
                applies="deploy",
                storage=ref,
                sourceRef=ref,
            )
        )
    return rows


def configuration_rows() -> list[SettingRow]:
    """Every `.env` value, frontend build value and code constant, as rows."""
    builds = [s for s in _env_manifest().values() if s["scope"] == "frontend_build"]
    return [
        *(_env_row(name) for name in sorted(Settings.model_fields)),
        *(_build_row(spec) for spec in builds),
        *_code_rows(),
    ]


def configuration_row(setting_id: str) -> SettingRow | None:
    return next((r for r in configuration_rows() if r.id == setting_id), None)


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
