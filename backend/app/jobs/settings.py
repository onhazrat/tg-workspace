"""Load settings with their defaults, and route writes to the right table.

Ticket 06 split settings in two: `tg_app_settings` for deployment policy and
`tg_user_settings` for personal preference, with
`services/settings_registry.py` saying which key is which. This module is the
layer above both — it merges stored values over the env-derived defaults, and
for `sync` and `retention` it hides the fact that one JSON blob is now several
rows across two tables.

**The facades are the interesting part.** `GET`/`PUT /data/settings/sync` and
`/retention` keep their exact old wire shape, so neither the browser nor the
generated client changed, but underneath each field goes to the table it
belongs to.

For `sync` (ticket 06) that is scheduler policy and the scheduler's own
counters global, and the per-channel defaults a person picks theirs. That is
what removes the lost update: every writer used to read-modify-write the whole
blob, so a person saving a start-time preference wrote back whatever
`consecutiveFailures` their browser last read, and the scheduler bumping its
counter wrote back their stale preferences.

For `retention` (ticket 20) it is windows over shared rows global and windows
over an account's own rows theirs. The lost update there was worse than a stale
counter: one blob meant one `postRetentionDays` any account could set, and it
deletes every account's Posts on the next sweep.
"""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime
from typing import Any, cast

from sqlmodel import Session, select

from app.core.config import settings
from app.models import User
from app.services.settings_registry import (
    RETENTION_KEY,
    RETENTION_PREFS_KEY,
    SYNC_KEY,
    SYNC_PREFS_KEY,
    SYNC_RUNTIME_KEY,
    Home,
    home_for,
    split_retention_payload,
    split_sync_payload,
)
from app.services.settings_store import (
    get_global_setting,
    put_global_setting,
    replace_global_setting,
)
from app.services.user_settings import (
    all_user_settings,
    get_user_setting,
    put_user_setting,
    replace_user_setting,
)

JOB_IDS = (
    "auto_sync",
    "embeddings",
    "auto_summary",
    "retention",
    "translation_batch",
    "discover_probe",
)


def default_job_enabled(job_id: str) -> bool:
    defaults: dict[str, bool] = {
        "auto_sync": settings.JOBS_AUTO_SYNC_ENABLED_DEFAULT,
        "embeddings": settings.JOBS_EMBEDDINGS_ENABLED_DEFAULT,
        "auto_summary": settings.JOBS_AUTO_SUMMARY_ENABLED_DEFAULT,
        "retention": settings.JOBS_RETENTION_ENABLED_DEFAULT,
        "translation_batch": settings.JOBS_TRANSLATION_BATCH_ENABLED_DEFAULT,
        "discover_probe": settings.JOBS_DISCOVER_PROBE_ENABLED_DEFAULT,
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
        # Declared here from ticket 06 on. They were always part of the blob —
        # the frontend writes them and `compute_effective_global_start_time_ms`
        # reads them — but only ever as `.get(...) or "retention"` fallbacks, so
        # the key set of a never-configured install did not list them. The
        # registry needs the full field list to partition, and these two values
        # are exactly what the reader and the browser already assume.
        "globalStartTimeMode": "retention",
        "globalStartTimeValue": None,
        "consecutiveFailures": 0,
        "autoSyncPauseUntil": None,
        "autoSyncPartialCursor": 0,
        "autoSyncPartialBatchSize": 1,
    }


def _default_retention_policy() -> dict[str, Any]:
    """Deployment half of the old `retention` blob (ticket 20)."""
    return {
        "postRetentionDays": settings.RETENTION_POST_DAYS_DEFAULT,
        "payloadRetentionDays": settings.RETENTION_PAYLOAD_DAYS_DEFAULT,
        "sharedLogRetentionDays": settings.RETENTION_SHARED_LOG_DAYS_DEFAULT,
    }


def _default_retention_prefs() -> dict[str, Any]:
    """Personal half: windows over the rows one account owns (ticket 20)."""
    return {
        "logRetentionDays": settings.RETENTION_LOG_DAYS_DEFAULT,
        # Both caps apply to saved Discover reports, whichever bites first, and
        # 0 disables either one — same convention as the windows above.
        "reportRetentionDays": settings.RETENTION_REPORT_DAYS_DEFAULT,
        "reportRetentionMax": settings.RETENTION_REPORT_MAX_DEFAULT,
    }


def _default_media() -> dict[str, Any]:
    return {
        "thumbCacheEnabled": True,
        "thumbCacheOnSync": True,
        "thumbCacheOnBackfill": True,
        "thumbCacheMaxSizeMb": settings.POST_THUMB_CACHE_MAX_SIZE_MB_DEFAULT,
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
    session: Session,
    key: str,
    defaults: dict[str, Any],
    *,
    user_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Stored value for `key` merged over `defaults`, from whichever table owns it.

    `user_id` is required for a per-User key and ignored for a global one, so
    the caller never has to know which it is — the registry does.
    """
    if home_for(key) is Home.USER:
        if user_id is None:
            return dict(defaults)
        return _merge(defaults, get_user_setting(session, key, user_id=user_id))
    return _merge(defaults, get_global_setting(session, key))


def save_settings_section(
    session: Session,
    key: str,
    value: dict[str, Any],
    *,
    user_id: uuid.UUID | None = None,
) -> None:
    """Write `value` as the whole section under `key`, into the table that owns it.

    Replaces the old `save_setting` and keeps its **replace** semantics, not the
    endpoint's merge: callers here hold a complete section, and `{}` has to mean
    "unset this" — clearing the follow-backfill marker is exactly that, and a
    merge cannot express it.

    `sync` and `retention` are the exceptions and delegate, because their
    destinations each take only the fields this call actually names. Passing a
    partial body is the normal case for a facade, and replacing a section with
    it would drop the fields the caller said nothing about.

    A per-User key with no owner raises rather than resolving one through
    `get_operator_user_id` — the NULL fallback the plan's decision 24 dissolves.
    """
    if key == SYNC_KEY:
        save_sync_settings(session, value, user_id=user_id)
        return
    if key == RETENTION_KEY:
        save_retention_settings(session, value, user_id=user_id)
        return
    if home_for(key) is Home.USER:
        if user_id is None:
            raise ValueError(
                f"Settings key {key!r} is per-User and needs an owner; there is "
                f"no deployment-wide row to fall back to."
            )
        replace_user_setting(session, key, value, user_id=user_id)
        return
    replace_global_setting(session, key, value)


def save_sync_settings(
    session: Session,
    payload: dict[str, Any],
    *,
    user_id: uuid.UUID | None = None,
) -> None:
    """Fan an old-shape `sync` body out to the three rows it now lives in.

    Only the sections the payload actually touches are written, so a browser
    saving its preferences never rewrites the scheduler's counters and the
    scheduler bumping a counter never rewrites anybody's preferences. Fields
    the registry does not recognise are dropped rather than guessed at.

    Preference fields are skipped when there is no owner: the scheduler writes
    through here too, and it has no account behind it.
    """
    sections = split_sync_payload(payload)
    for key, section in sections.items():
        if key == SYNC_PREFS_KEY:
            if user_id is not None:
                put_user_setting(session, key, section, user_id=user_id)
            continue
        put_global_setting(session, key, section)


def load_jobs_settings(session: Session) -> dict[str, Any]:
    return load_setting(session, "jobs", _default_jobs())


def load_sync_settings(
    session: Session, *, user_id: uuid.UUID | None = None
) -> dict[str, Any]:
    """The old `sync` blob, reassembled from the three rows it now lives in.

    Callers see exactly the dict they saw before ticket 06, which is what lets
    the endpoint, the scheduler and the orchestrator stay unchanged above this
    line. `user_id` supplies the preference half; the scheduler passes none
    because it reads only policy and runtime fields, both global — see
    `test_the_scheduler_reads_runtime_without_an_owner`.
    """
    defaults = _default_sync()
    stored = {
        **get_global_setting(session, SYNC_KEY),
        **get_global_setting(session, SYNC_RUNTIME_KEY),
    }
    if user_id is not None:
        stored.update(get_user_setting(session, SYNC_PREFS_KEY, user_id=user_id))
    merged = _merge(defaults, stored)

    legacy_interval = stored.get("autoSyncInterval")
    if "regularSyncIntervalMinutes" not in stored and isinstance(
        legacy_interval, (int, float)
    ):
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

    # No write-back. This used to persist the normalised blob whenever it
    # differed from the stored one, which put a commit on the hot path of every
    # scheduler read — the shape `docs/scheduler-db-cost-plan.md` measured at 69
    # minutes of database time per 10 hours. The clamping above is deterministic,
    # so recomputing it per read costs nothing, and the legacy keys it used to
    # clean up are carved out once by the ticket 06 migration instead.
    return merged


def load_retention_policy(session: Session) -> dict[str, Any]:
    """The deployment's retention windows, with no personal fields in them.

    What every caller outside the endpoint actually wants: the scrape stop
    bound reads `postRetentionDays` and nothing else, and the retention job
    reads the three policy windows separately from each account's own. Asking
    for the reassembled blob there would hand those callers three more fields
    they have no owner to resolve and no business reading.
    """
    return _merge(
        _default_retention_policy(), get_global_setting(session, RETENTION_KEY)
    )


def load_retention_prefs_by_user(session: Session) -> dict[uuid.UUID, dict[str, Any]]:
    """Every account's log and report windows, in two queries rather than 2N.

    The retention job runs hourly forever, so it reads the whole set at once and
    groups accounts by the window they chose. Reading a setting per account
    inside the sweep is the shape that made the auto-sync tick cost 69 minutes
    of database time per 10 hours: a scheduled job pays its query count every
    tick, and nobody is watching to notice.

    Every account appears, including the ones that never saved a preference —
    the defaults are what their rows are swept on, and an account missing from
    this map would be an account whose logs nothing ever collects.
    """
    defaults = _default_retention_prefs()
    stored = all_user_settings(session, RETENTION_PREFS_KEY)
    return {
        user_id: _merge(defaults, stored.get(user_id))
        for user_id in session.exec(select(User.id)).all()
    }


def load_retention_prefs(session: Session, *, user_id: uuid.UUID) -> dict[str, Any]:
    """One account's own log and report windows.

    `user_id` is required, with no default. The alternative — resolving a
    missing owner to the operator — is the fallback plan decision 24 dissolves,
    and here it would mean sweeping somebody's rows on a window they never set.
    """
    return _merge(
        _default_retention_prefs(),
        get_user_setting(session, RETENTION_PREFS_KEY, user_id=user_id),
    )


def load_retention_settings(
    session: Session, *, user_id: uuid.UUID | None = None
) -> dict[str, Any]:
    """The old `retention` blob, reassembled from the two rows it now lives in.

    The facade `GET /data/settings/retention` answers with, exactly as
    `load_sync_settings` is for `sync`: the wire shape is unchanged, so neither
    the browser nor the generated client changed when ticket 20 split the row.
    With no `user_id` the personal half falls back to its defaults, which is
    what a caller with no account in hand would have to show anyway.
    """
    merged = load_retention_policy(session)
    merged.update(_default_retention_prefs())
    if user_id is not None:
        merged.update(get_user_setting(session, RETENTION_PREFS_KEY, user_id=user_id))
    return merged


def save_retention_settings(
    session: Session,
    payload: dict[str, Any],
    *,
    user_id: uuid.UUID | None = None,
) -> None:
    """Fan an old-shape `retention` body out to the two rows it now lives in.

    Only the sections the payload names are written, so an Admin saving the
    corpus window never rewrites their own report caps and a person saving
    their log window never touches deployment policy.

    A personal field with no owner **raises**, unlike `save_sync_settings`,
    which drops one. The difference is who writes: the scheduler writes `sync`
    with no account behind it and would fail on every tick, whereas every
    caller here has a User in hand. Dropping is how a window silently keeps its
    default while the caller believes it saved — which is exactly what a
    settings write must not do.
    """
    sections = split_retention_payload(payload)
    if RETENTION_PREFS_KEY in sections and user_id is None:
        raise ValueError(
            f"Retention field(s) {sorted(sections[RETENTION_PREFS_KEY])} are "
            f"per-User and need an owner; there is no deployment-wide row to "
            f"fall back to."
        )
    for key, section in sections.items():
        if key == RETENTION_PREFS_KEY:
            put_user_setting(session, key, section, user_id=cast(uuid.UUID, user_id))
            continue
        put_global_setting(session, key, section)


def load_media_settings(session: Session) -> dict[str, Any]:
    defaults = _default_media()
    merged = load_setting(session, "media", defaults)
    if not isinstance(merged.get("thumbCacheEnabled"), bool):
        merged["thumbCacheEnabled"] = defaults["thumbCacheEnabled"]
    if not isinstance(merged.get("thumbCacheOnSync"), bool):
        merged["thumbCacheOnSync"] = defaults["thumbCacheOnSync"]
    if not isinstance(merged.get("thumbCacheOnBackfill"), bool):
        merged["thumbCacheOnBackfill"] = defaults["thumbCacheOnBackfill"]
    max_mb = merged.get("thumbCacheMaxSizeMb")
    if not isinstance(max_mb, int) or max_mb < 0:
        merged["thumbCacheMaxSizeMb"] = defaults["thumbCacheMaxSizeMb"]
    return merged


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
        date_str = value if isinstance(value, str) else datetime.now(UTC).isoformat()
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
    save_settings_section(session, "jobs", jobs)
    return jobs
