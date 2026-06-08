"""Load scheduler-related AppSetting values with defaults."""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.models_tg import AppSetting, utc_now

JOB_IDS = ("auto_sync", "embeddings", "auto_summary", "retention", "translation_batch")

_DEFAULT_JOBS: dict[str, dict[str, Any]] = {
    job_id: {"enabled": True} for job_id in JOB_IDS
}

_DEFAULT_SYNC: dict[str, Any] = {
    "autoSyncEnabled": True,
    "autoSyncInterval": 60,
    "syncConcurrency": 3,
    "autoFollowForwarded": False,
    "consecutiveFailures": 0,
    "autoSyncPauseUntil": None,
}

_DEFAULT_RETENTION: dict[str, Any] = {
    "postRetentionDays": 90,
    "logRetentionDays": 30,
}

_DEFAULT_TRANSLATION: dict[str, Any] = {
    "translationEnabled": False,
    "autoTranslate": False,
    "translationModel": "gemini-3-flash-preview",
    "translationTargetLanguage": "English",
}


def _merge(defaults: dict[str, Any], stored: dict[str, Any] | None) -> dict[str, Any]:
    return {**defaults, **(stored or {})}


def load_setting(session: Session, key: str, defaults: dict[str, Any]) -> dict[str, Any]:
    row = session.get(AppSetting, key)
    return _merge(defaults, row.value if row else None)


def save_setting(session: Session, key: str, value: dict[str, Any], user_id=None) -> None:
    row = session.get(AppSetting, key)
    if row:
        row.value = value
        row.updated_at = utc_now()
    else:
        row = AppSetting(key=key, value=value, user_id=user_id)
    session.add(row)
    session.commit()


def load_jobs_settings(session: Session) -> dict[str, Any]:
    return load_setting(session, "jobs", _DEFAULT_JOBS)


def load_sync_settings(session: Session) -> dict[str, Any]:
    return load_setting(session, "sync", _DEFAULT_SYNC)


def load_retention_settings(session: Session) -> dict[str, Any]:
    return load_setting(session, "retention", _DEFAULT_RETENTION)


def load_translation_settings(session: Session) -> dict[str, Any]:
    return load_setting(session, "translation", _DEFAULT_TRANSLATION)


def is_job_enabled(session: Session, job_id: str) -> bool:
    jobs = load_jobs_settings(session)
    entry = jobs.get(job_id, {})
    if isinstance(entry, dict):
        return bool(entry.get("enabled", True))
    return True


def set_job_enabled(session: Session, job_id: str, enabled: bool) -> dict[str, Any]:
    jobs = load_jobs_settings(session)
    entry = jobs.get(job_id, {})
    if not isinstance(entry, dict):
        entry = {}
    entry["enabled"] = enabled
    jobs[job_id] = entry
    save_setting(session, "jobs", jobs)
    return jobs
