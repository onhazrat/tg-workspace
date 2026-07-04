"""Load scheduler-related AppSetting values with defaults."""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session

from app.core.config import settings
from app.models_tg import AppSetting, utc_now

JOB_IDS = ("auto_sync", "embeddings", "auto_summary", "retention", "translation_batch")


def default_job_enabled(job_id: str) -> bool:
    defaults: dict[str, bool] = {
        "auto_sync": settings.JOBS_AUTO_SYNC_ENABLED_DEFAULT,
        "embeddings": settings.JOBS_EMBEDDINGS_ENABLED_DEFAULT,
        "auto_summary": settings.JOBS_AUTO_SUMMARY_ENABLED_DEFAULT,
        "retention": settings.JOBS_RETENTION_ENABLED_DEFAULT,
        "translation_batch": settings.JOBS_TRANSLATION_BATCH_ENABLED_DEFAULT,
    }
    return defaults.get(job_id, True)


def _default_jobs() -> dict[str, dict[str, Any]]:
    return {job_id: {"enabled": default_job_enabled(job_id)} for job_id in JOB_IDS}


def _default_sync() -> dict[str, Any]:
    return {
        "regularSyncIntervalMinutes": settings.AUTO_SYNC_INTERVAL_MINUTES_DEFAULT,
        "dynamicSyncEnabledDefault": False,
        "dynamicSyncExpectedPostsDefault": 15,
        "syncFailureBackoffMinutes": 5,
        "syncConcurrency": settings.SYNC_CONCURRENCY_DEFAULT,
        "consecutiveFailures": 0,
        "autoSyncPauseUntil": None,
        "autoSyncPartialCursor": 0,
        "autoSyncPartialBatchSize": 1,
    }


def _default_retention() -> dict[str, Any]:
    return {
        "postRetentionDays": settings.RETENTION_POST_DAYS_DEFAULT,
        "logRetentionDays": settings.RETENTION_LOG_DAYS_DEFAULT,
    }


def _default_translation() -> dict[str, Any]:
    return {
        "translationEnabled": False,
        "autoTranslate": False,
        "translationModel": settings.DEFAULT_AI_MODEL,
        "translationTargetLanguage": settings.TRANSLATION_TARGET_LANGUAGE_DEFAULT,
    }


def _merge(defaults: dict[str, Any], stored: dict[str, Any] | None) -> dict[str, Any]:
    return {**defaults, **(stored or {})}


def load_setting(
    session: Session, key: str, defaults: dict[str, Any]
) -> dict[str, Any]:
    row = session.get(AppSetting, key)
    return _merge(defaults, row.value if row else None)


def save_setting(
    session: Session, key: str, value: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    if user_id is None:
        from app.services.operator import get_operator_user_id

        user_id = get_operator_user_id(session)
    row = session.get(AppSetting, key)
    if row:
        row.value = value
        row.updated_at = utc_now()
        if row.user_id is None and user_id is not None:
            row.user_id = user_id
    else:
        row = AppSetting(key=key, value=value, user_id=user_id)
    session.add(row)
    session.commit()


def load_jobs_settings(session: Session) -> dict[str, Any]:
    return load_setting(session, "jobs", _default_jobs())


def load_sync_settings(session: Session) -> dict[str, Any]:
    defaults = _default_sync()
    row = session.get(AppSetting, "sync")
    stored = row.value if row else None
    merged = _merge(defaults, stored)

    legacy_interval = (stored or {}).get("autoSyncInterval")
    stored_has_regular_interval = isinstance(stored, dict) and (
        "regularSyncIntervalMinutes" in stored
    )
    if not stored_has_regular_interval and isinstance(legacy_interval, (int, float)):
        merged["regularSyncIntervalMinutes"] = int(legacy_interval)

    if not isinstance(merged.get("regularSyncIntervalMinutes"), int):
        merged["regularSyncIntervalMinutes"] = (
            settings.AUTO_SYNC_INTERVAL_MINUTES_DEFAULT
        )
    if merged["regularSyncIntervalMinutes"] < 1:
        merged["regularSyncIntervalMinutes"] = 1

    if not isinstance(merged.get("dynamicSyncEnabledDefault"), bool):
        merged["dynamicSyncEnabledDefault"] = False
    if not isinstance(merged.get("dynamicSyncExpectedPostsDefault"), int):
        merged["dynamicSyncExpectedPostsDefault"] = 15
    if merged["dynamicSyncExpectedPostsDefault"] < 1:
        merged["dynamicSyncExpectedPostsDefault"] = 1
    if not isinstance(merged.get("syncFailureBackoffMinutes"), int):
        merged["syncFailureBackoffMinutes"] = 5
    if merged["syncFailureBackoffMinutes"] < 1:
        merged["syncFailureBackoffMinutes"] = 1

    merged.pop("autoSyncEnabled", None)
    merged.pop("autoSyncInterval", None)

    if row and row.value != merged:
        row.value = merged
        row.updated_at = utc_now()
        session.add(row)
        session.commit()
    return merged


def load_retention_settings(session: Session) -> dict[str, Any]:
    return load_setting(session, "retention", _default_retention())


def load_translation_settings(session: Session) -> dict[str, Any]:
    return load_setting(session, "translation", _default_translation())


def compute_effective_global_start_time_ms(
    sync_settings: dict[str, Any],
    retention_settings: dict[str, Any],
    *,
    now_ms: int | None = None,
) -> int:
    """Mirror frontend getEffectiveGlobalStartTime() for server-side channel creation."""
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    mode = sync_settings.get("globalStartTimeMode") or "retention"
    value = sync_settings.get("globalStartTimeValue")
    post_retention_days = int(retention_settings.get("postRetentionDays") or 0)
    day_ms = 24 * 60 * 60 * 1000

    if mode == "retention":
        target_time = (
            now - post_retention_days * day_ms if post_retention_days > 0 else 0
        )
    elif mode == "relative":
        if isinstance(value, (int, float)) and int(value) > 0:
            target_time = now - int(value) * day_ms
        else:
            target_time = (
                now - post_retention_days * day_ms if post_retention_days > 0 else 0
            )
    elif mode == "absolute":
        date_str = (
            value if isinstance(value, str) else datetime.now(timezone.utc).isoformat()
        )
        try:
            parsed = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            target_time = int(parsed.timestamp() * 1000)
        except ValueError:
            target_time = now
    else:
        target_time = now

    if post_retention_days > 0:
        min_allowed = now - post_retention_days * day_ms
        if target_time < min_allowed:
            target_time = min_allowed

    return target_time


def compute_scrape_cutoff_ms(
    sync_settings: dict[str, Any],
    retention_settings: dict[str, Any],
    *,
    now_ms: int | None = None,
) -> int:
    """Backward scrape stop bound: max(retentionCutoff, globalStartTime)."""
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    post_retention_days = int(retention_settings.get("postRetentionDays") or 0)
    day_ms = 24 * 60 * 60 * 1000

    retention_cutoff = (
        now - post_retention_days * day_ms if post_retention_days > 0 else 0
    )
    global_start = compute_effective_global_start_time_ms(
        sync_settings, retention_settings, now_ms=now
    )

    if retention_cutoff > 0 or global_start > 0:
        return max(retention_cutoff, global_start)
    return 0


def channel_resolve_target_ms(
    channel_start_time_ms: int | None,
    effective_start_time_ms: int,
) -> int:
    """Timestamp (ms) to use when resolving start_id for a channel."""
    channel_start = channel_start_time_ms or 0
    if channel_start <= 0:
        return effective_start_time_ms
    if effective_start_time_ms <= 0:
        return channel_start
    return max(channel_start, effective_start_time_ms)


def needs_start_id_resolve(
    *,
    start_id: int | None,
    channel_start_time_ms: int | None,
    effective_start_time_ms: int,
) -> bool:
    """Whether sync should (re)resolve start_id from a wall-clock timestamp."""
    if start_id is None:
        return True
    # start_time=0 is a legacy placeholder; re-resolve using global policy.
    if (channel_start_time_ms or 0) <= 0 and effective_start_time_ms > 0:
        return True
    return False


def is_job_enabled(session: Session, job_id: str) -> bool:
    jobs = load_jobs_settings(session)
    entry = jobs.get(job_id, {})
    if isinstance(entry, dict):
        return bool(entry.get("enabled", default_job_enabled(job_id)))
    return default_job_enabled(job_id)


def set_job_enabled(session: Session, job_id: str, enabled: bool) -> dict[str, Any]:
    jobs = load_jobs_settings(session)
    entry = jobs.get(job_id, {})
    if not isinstance(entry, dict):
        entry = {}
    entry["enabled"] = enabled
    jobs[job_id] = entry
    save_setting(session, "jobs", jobs)
    return jobs
