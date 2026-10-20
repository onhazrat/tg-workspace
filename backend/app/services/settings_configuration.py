"""Read model: the deployment's Configuration as Settings-page rows (SET-04, ADR-032).

Every `.env` value the backend reads, every frontend build value and every
tuning constant. Only a holder of `settings:manage` sees any of it, and none
of it is writable through the page: `.env` needs a restart, a build value a
rebuild and a constant a deploy. Split from `settings_page`, which answers the
declared Settings, because this half changes for a different reason: it reads
`config.py`'s source, the dotenv files and the generated catalogs.
"""

from __future__ import annotations

import ast
import json
import os
import re
from collections import Counter
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import JsonValue
from pydantic_core import PydanticUndefined

from app.core.config import SENSITIVE_CONFIG_SUFFIXES, Settings, settings
from app.schemas.settings_registry import SettingRow, SettingRowType
from app.services.network_settings import redact_proxy_url
from app.services.setting_declarations import CONSTANT_TOPICS, env_topic

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


_DOTENV_ASSIGNMENT = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")


def dotenv_names_in(
    configured: str | Path | Sequence[str | Path] | None, roots: Sequence[Path]
) -> frozenset[str]:
    """Names assigned by the dotenv files `configured` names, without their values.

    A relative path is looked up under each of `roots` in turn; a missing file
    is skipped, because pydantic-settings skips it too.
    """
    if not configured:
        return frozenset()
    paths = [configured] if isinstance(configured, (str, Path)) else list(configured)
    names: set[str] = set()
    for raw in paths:
        path = Path(raw)
        candidates = [path] if path.is_absolute() else [root / path for root in roots]
        found = next((c for c in candidates if c.is_file()), None)
        if found is None:
            continue
        for line in found.read_text().splitlines():
            if match := _DOTENV_ASSIGNMENT.match(line):
                names.add(match.group(1).upper())
    return frozenset(names)


@lru_cache(maxsize=1)
def _dotenv_names() -> frozenset[str]:
    """Names the configured dotenv files assign, without loading their values."""
    return dotenv_names_in(
        Settings.model_config.get("env_file"),
        [Path.cwd(), Path(__file__).resolve().parents[2]],
    )


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


def _env_id(name: str) -> str:
    return f"{env_topic(name)}.env.{_camel(name)}"


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
        id=_env_id(name),
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
        id=_env_id(name),
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


@lru_cache(maxsize=1)
def _configuration_locks() -> dict[str, str]:
    """Each Configuration id and its lock. Ids and locks are fixed for a process
    (the `Settings` fields, the env manifest and the constants catalog), so the
    rows are built once rather than on every write."""
    return {row.id: row.lock_reason or "" for row in configuration_rows()}


def configuration_lock(setting_id: str) -> str | None:
    """Why `setting_id` cannot be written here, if it names Configuration."""
    return _configuration_locks().get(setting_id)
