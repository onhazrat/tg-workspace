"""Build the redacted, admin-facing inventory of all configuration layers."""

from __future__ import annotations

import json
import os
import re
import uuid
from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic_core import PydanticUndefined
from sqlmodel import Session

from app.core.config import Settings, settings
from app.jobs.settings import (
    load_directory_settings,
    load_jobs_settings,
    load_media_settings,
    load_retention_policy,
    load_retention_settings,
    load_sync_settings,
    load_translation_settings,
)
from app.schemas.configuration import (
    ConfigurationCatalogResponse,
    ConfigurationEntry,
    ConfigurationLayer,
)
from app.services.network_settings import load_network_settings, redact_proxy_url
from app.services.quota_limits import all_limits
from app.services.settings_registry import (
    GLOBAL_KEYS,
    RETENTION_PREF_FIELDS,
    RETENTION_PREFS_KEY,
    SYNC_POLICY_FIELDS,
    SYNC_PREF_FIELDS,
    SYNC_PREFS_KEY,
    SYNC_RUNTIME_FIELDS,
    SYNC_RUNTIME_KEY,
    USER_KEYS,
)
from app.services.settings_store import get_global_setting
from app.services.user_settings import get_user_setting

_CATALOG_PATH = Path(__file__).resolve().parents[1] / "core/env_catalog.generated.json"
_REDACTED = "••••••"
_SENSITIVE_SUFFIXES = ("_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_DSN")
_SENSITIVE_WORDS = {"KEY", "TOKEN", "SECRET", "PASSWORD", "DSN"}


def _label(key: str) -> str:
    return key.replace("_", " ").replace("-", " ").title()


def _jsonable(value: Any) -> Any:
    if value is PydanticUndefined:
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    return str(value)


def _redact(value: Any, *, sensitive: bool = False) -> Any:
    if sensitive:
        return _REDACTED if value not in (None, "", [], {}) else value
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for raw_key, item in value.items():
            key = str(raw_key)
            normalized = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key)
            normalized = re.sub(r"[^A-Za-z0-9]+", "_", normalized).upper()
            safe_key = redact_proxy_url(key) or key
            redacted[safe_key] = _redact(
                item,
                sensitive=(
                    normalized in _SENSITIVE_WORDS
                    or normalized.endswith(_SENSITIVE_SUFFIXES)
                ),
            )
        return redacted
    if isinstance(value, list):
        return [_redact(item) for item in value]
    if isinstance(value, str):
        return redact_proxy_url(value) or value
    return _jsonable(value)


@lru_cache(maxsize=1)
def _manifest() -> tuple[dict[str, Any], ...]:
    return tuple(json.loads(_CATALOG_PATH.read_text())["variables"])


def _field_default(name: str) -> Any:
    field = Settings.model_fields[name]
    if field.default is not PydanticUndefined:
        return _jsonable(field.default)
    return None


@lru_cache(maxsize=1)
def _dotenv_names() -> frozenset[str]:
    """Return names declared in configured dotenv files without loading values."""
    configured = Settings.model_config.get("env_file")
    if not configured:
        return frozenset()
    paths = [configured] if isinstance(configured, (str, Path)) else list(configured)
    backend_root = Path(__file__).resolve().parents[2]
    names: set[str] = set()
    for raw_path in paths:
        path = Path(raw_path)
        candidates = (
            [path] if path.is_absolute() else [Path.cwd() / path, backend_root / path]
        )
        resolved = next(
            (candidate for candidate in candidates if candidate.is_file()), None
        )
        if resolved is None:
            continue
        for line in resolved.read_text().splitlines():
            match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
            if match:
                names.add(match.group(1).upper())
    return frozenset(names)


def _deployment_entries() -> list[ConfigurationEntry]:
    manifest = {item["name"]: item for item in _manifest()}
    entries: list[ConfigurationEntry] = []
    backend_names = set(Settings.model_fields)
    dotenv_names = _dotenv_names()
    for name in sorted(backend_names):
        spec = manifest.get(name, {})
        sensitive = bool(spec.get("sensitive"))
        value = _jsonable(getattr(settings, name))
        in_environment = name in os.environ
        in_dotenv = name in dotenv_names
        configured = in_environment or in_dotenv
        entries.append(
            ConfigurationEntry(
                id=f"deployment:{name}",
                key=name,
                label=_label(name),
                layer="deployment",
                value=_redact(value, sensitive=sensitive),
                default_value=_redact(_field_default(name), sensitive=sensitive),
                source=(
                    "environment"
                    if in_environment
                    else ".env"
                    if in_dotenv
                    else "code default"
                ),
                description=(
                    "Backend runtime setting. Environment values override the code default."
                ),
                sensitive=sensitive,
                configured=configured,
                restart_required=True,
            )
        )

    # Compose/tooling variables are real deployment inputs but not backend
    # Settings fields. They still belong in the inventory and generated example.
    for name, spec in sorted(manifest.items()):
        if name in backend_names or spec["scope"] == "frontend_build":
            continue
        configured = name in os.environ
        raw = os.environ.get(name, spec.get("default"))
        sensitive = bool(spec.get("sensitive"))
        entries.append(
            ConfigurationEntry(
                id=f"deployment:{name}",
                key=name,
                label=_label(name),
                layer="deployment",
                value=_redact(raw, sensitive=sensitive),
                default_value=_redact(spec.get("default"), sensitive=sensitive),
                source="environment" if configured else spec["scope"],
                description=f"Discovered from {spec['scope']} source usage.",
                sensitive=sensitive,
                configured=configured,
                restart_required=True,
            )
        )
    return entries


def _effective_global(
    session: Session, key: str, sync_settings: dict[str, Any]
) -> dict[str, Any]:
    if key == "jobs":
        return load_jobs_settings(session)
    if key == "sync":
        return {field: sync_settings.get(field) for field in sorted(SYNC_POLICY_FIELDS)}
    if key == SYNC_RUNTIME_KEY:
        return {
            field: sync_settings.get(field) for field in sorted(SYNC_RUNTIME_FIELDS)
        }
    if key == "retention":
        return load_retention_policy(session)
    if key == "media":
        return load_media_settings(session)
    if key == "translation":
        return load_translation_settings(session)
    if key == "network":
        return load_network_settings(session)
    if key == "directory":
        return load_directory_settings(session)
    return get_global_setting(session, key)


def _global_entries(session: Session) -> list[ConfigurationEntry]:
    entries: list[ConfigurationEntry] = []
    sync_settings = load_sync_settings(session)
    for key, description in GLOBAL_KEYS.items():
        stored = get_global_setting(session, key)
        value = _effective_global(session, key, sync_settings)
        sensitive = key == "network"
        entries.append(
            ConfigurationEntry(
                id=f"global:{key}",
                key=key,
                label=_label(key),
                layer="global",
                value=_redact(value),
                source="database override" if stored else "environment/code default",
                description=description,
                sensitive=sensitive,
                configured=bool(stored),
                editable=key not in {SYNC_RUNTIME_KEY, "follows_backfill"},
            )
        )
    return entries


def _user_entries(session: Session, user_id: uuid.UUID) -> list[ConfigurationEntry]:
    sync = load_sync_settings(session, user_id=user_id)
    retention = load_retention_settings(session, user_id=user_id)
    effective = {
        SYNC_PREFS_KEY: {key: sync.get(key) for key in sorted(SYNC_PREF_FIELDS)},
        RETENTION_PREFS_KEY: {
            key: retention.get(key) for key in sorted(RETENTION_PREF_FIELDS)
        },
    }
    entries: list[ConfigurationEntry] = []
    for key, description in USER_KEYS.items():
        stored = get_user_setting(session, key, user_id=user_id)
        entries.append(
            ConfigurationEntry(
                id=f"user:{key}",
                key=key,
                label=_label(key),
                layer="user",
                value=effective.get(key, stored),
                source="user database override"
                if stored
                else "environment/code default",
                description=description,
                configured=bool(stored),
                editable=True,
                owner_id=str(user_id),
            )
        )
    return entries


def _specialized_entries(session: Session) -> list[ConfigurationEntry]:
    rows = all_limits(session)
    if not rows:
        return [
            ConfigurationEntry(
                id="specialized:quota-limits",
                key="quota_limits",
                label="Quota Limits",
                layer="specialized",
                value={},
                source="no overrides",
                description="Per-account quota overrides; empty values inherit global defaults.",
                editable=True,
            )
        ]
    return [
        ConfigurationEntry(
            id=f"specialized:quota:{row.user_id}:{row.budget}",
            key=f"quota.{row.budget}",
            label=f"Quota {_label(row.budget)}",
            layer="specialized",
            value={"allowance": row.allowance, "ceiling": row.ceiling},
            source="specialized database override",
            description="Per-account quota override; null values inherit global defaults.",
            configured=True,
            editable=True,
            owner_id=str(row.user_id),
        )
        for row in rows
    ]


def _frontend_entries() -> list[ConfigurationEntry]:
    return [
        ConfigurationEntry(
            id=f"frontend:{spec['name']}",
            key=spec["name"],
            label=_label(spec["name"]),
            layer="frontend",
            value=None,
            default_value=_redact(
                spec.get("default"), sensitive=bool(spec.get("sensitive"))
            ),
            source="frontend build (reported by browser)",
            description="Vite build-time value. Rebuild the frontend to change it.",
            sensitive=bool(spec.get("sensitive")),
            restart_required=True,
        )
        for spec in _manifest()
        if spec["scope"] == "frontend_build"
    ]


def build_configuration_catalog(
    session: Session, *, user_id: uuid.UUID
) -> ConfigurationCatalogResponse:
    """Return five ordered layers, with secret-bearing values redacted."""
    return ConfigurationCatalogResponse(
        layers=[
            ConfigurationLayer(
                id="deployment",
                label="Deployment environment",
                description="Process, .env, Compose, and tooling inputs.",
                entries=_deployment_entries(),
            ),
            ConfigurationLayer(
                id="global",
                label="Global runtime settings",
                description="Database settings shared by every account.",
                entries=_global_entries(session),
            ),
            ConfigurationLayer(
                id="user",
                label="Your user settings",
                description="The current administrator's per-account preferences.",
                entries=_user_entries(session, user_id),
            ),
            ConfigurationLayer(
                id="specialized",
                label="Specialized overrides",
                description="Purpose-built per-account overrides such as quota limits.",
                entries=_specialized_entries(session),
            ),
            ConfigurationLayer(
                id="frontend",
                label="Frontend build configuration",
                description="Public Vite values frozen into this browser bundle.",
                entries=_frontend_entries(),
            ),
        ]
    )
