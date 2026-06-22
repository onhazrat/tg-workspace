"""Assemble effective runtime configuration for sync, scraping, jobs, and network."""

from __future__ import annotations

import time
import uuid
from typing import Any

from sqlmodel import Session

from app.core.config import settings
from app.jobs.settings import (
    JOB_IDS,
    compute_effective_global_start_time_ms,
    compute_scrape_cutoff_ms,
    default_job_enabled,
    load_jobs_settings,
    load_retention_settings,
    load_sync_settings,
)
from app.services.network_settings import (
    compute_proxy_pool_capacity,
    load_network_settings,
    redact_proxy_url,
    resolve_proxies,
    resolve_proxy_concurrency,
)
from app.services.proxy_pool import configure_proxy_pool, get_proxy_pool
from app.services.scraper_jobs import get_active_sync_job_summary


def _sync_runtime_payload(sync_settings: dict[str, Any]) -> dict[str, Any]:
    return {
        "autoSyncEnabled": bool(sync_settings.get("autoSyncEnabled", True)),
        "autoSyncInterval": int(
            sync_settings.get("autoSyncInterval")
            or settings.AUTO_SYNC_INTERVAL_MINUTES_DEFAULT
        ),
        "syncConcurrency": max(
            1,
            int(
                sync_settings.get("syncConcurrency")
                or settings.SYNC_CONCURRENCY_DEFAULT
            ),
        ),
        "consecutiveFailures": int(sync_settings.get("consecutiveFailures") or 0),
        "autoSyncPauseUntil": sync_settings.get("autoSyncPauseUntil"),
        "globalStartTimeMode": sync_settings.get("globalStartTimeMode") or "retention",
        "globalStartTimeValue": sync_settings.get("globalStartTimeValue"),
    }


def _network_runtime_payload(
    session: Session,
    user_id: uuid.UUID | None,
) -> dict[str, Any]:
    network = load_network_settings(session, user_id)
    resolved = resolve_proxies(network)
    default_slots, overrides = resolve_proxy_concurrency(network)
    effective_capacity = compute_proxy_pool_capacity(resolved, default_slots, overrides)
    if resolved:
        configure_proxy_pool(resolved, default_slots, overrides)
    pool = get_proxy_pool()
    lane_snapshot = pool.snapshot()
    if not lane_snapshot and resolved:
        from app.services.network import proxy_in_cooldown
        from app.services.network_settings import normalize_proxy_url

        lane_snapshot = [
            {
                "proxyUrl": normalize_proxy_url(proxy),
                "maxParallel": overrides.get(normalize_proxy_url(proxy), default_slots),
                "inUse": 0,
                "inCooldown": proxy_in_cooldown(normalize_proxy_url(proxy)),
            }
            for proxy in resolved
        ]
    proxy_lanes = [
        {
            **lane,
            "proxyUrl": redact_proxy_url(str(lane.get("proxyUrl") or ""))
            or str(lane.get("proxyUrl") or ""),
        }
        for lane in lane_snapshot
    ]
    redacted_overrides = {
        redact_proxy_url(url) or url: slots for url, slots in overrides.items()
    }
    tor_enabled = bool(network.get("torEnabled")) or settings.TOR_ENABLED
    tor_rotation_threshold = int(
        network.get("torRotationThreshold") or settings.NETWORK_TOR_ROTATION_THRESHOLD
    )
    tor_control_port = int(
        network.get("torControlPort")
        or network.get("torControlPortDefault")
        or settings.TOR_CONTROL_PORT
    )
    proxy_urls = [
        redact_proxy_url(url) or url for url in network.get("proxyUrls") or []
    ]
    tor_proxy_urls = network.get("torProxyUrls")
    if isinstance(tor_proxy_urls, str) and tor_proxy_urls.strip():
        tor_proxy_urls = redact_proxy_url(tor_proxy_urls)
    return {
        "proxyEnabled": bool(network.get("proxyEnabled")),
        "proxyUrls": proxy_urls,
        "torEnabled": bool(network.get("torEnabled")),
        "torMode": network.get("torMode"),
        "torProxyUrls": tor_proxy_urls,
        "torRotationStrategy": network.get("torRotationStrategy"),
        "torControlEnabled": bool(network.get("torControlEnabled")),
        "torControlPort": tor_control_port,
        "torAutoRotate": bool(network.get("torAutoRotate")),
        "torRotationThreshold": tor_rotation_threshold,
        "envFallbackConfigured": bool(network.get("envFallbackConfigured")),
        "usingEnvFallback": bool(network.get("usingEnvFallback")),
        "torAvailable": bool(network.get("torAvailable")),
        "torSocksProxy": network.get("torSocksProxy") or settings.TOR_SOCKS_PROXY,
        "effectiveTorEnabled": tor_enabled,
        "resolvedProxyCount": len(resolved),
        "resolvedProxies": [redact_proxy_url(url) or url for url in resolved],
        "fetchTimeoutSeconds": settings.NETWORK_FETCH_TIMEOUT_SECONDS,
        "fetchRetries": settings.NETWORK_FETCH_RETRIES,
        "fetchInitialDelayMs": settings.NETWORK_FETCH_INITIAL_DELAY_MS,
        "proxyCooldownMs": settings.NETWORK_PROXY_COOLDOWN_MS,
        "proxyDefaultConcurrency": default_slots,
        "proxyConcurrencyOverrides": redacted_overrides,
        "effectiveProxyCapacity": effective_capacity,
        "proxyLanes": proxy_lanes,
        "telegramApiRetries": settings.TELEGRAM_API_RETRIES,
        "telegramApiInitialDelayMs": settings.TELEGRAM_API_INITIAL_DELAY_MS,
    }


def _jobs_runtime_payload(session: Session) -> dict[str, Any]:
    jobs_cfg = load_jobs_settings(session)
    enabled: dict[str, bool] = {}
    for job_id in JOB_IDS:
        entry = jobs_cfg.get(job_id, {})
        if isinstance(entry, dict):
            enabled[job_id] = bool(entry.get("enabled", default_job_enabled(job_id)))
        else:
            enabled[job_id] = default_job_enabled(job_id)
    return {
        "enabled": enabled,
        "intervals": {
            "autoSyncCheckSeconds": settings.AUTO_SYNC_CHECK_INTERVAL_SECONDS,
            "embeddingsSeconds": settings.EMBEDDINGS_JOB_INTERVAL_SECONDS,
            "autoSummarySeconds": settings.AUTO_SUMMARY_JOB_INTERVAL_SECONDS,
            "retentionHours": settings.RETENTION_JOB_INTERVAL_HOURS,
            "translationBatchSeconds": settings.TRANSLATION_BATCH_JOB_INTERVAL_SECONDS,
        },
    }


def _constants_payload() -> dict[str, Any]:
    return {
        "syncMaxRetries": settings.SYNC_MAX_RETRIES,
        "syncRetryBackoffBaseMs": settings.SYNC_RETRY_BACKOFF_BASE_MS,
        "syncJobSseThrottleMs": settings.SYNC_JOB_SSE_THROTTLE_MS,
        "syncJobPersistIntervalMs": settings.SYNC_JOB_PERSIST_INTERVAL_MS,
        "autoSyncPauseDurationMs": settings.AUTO_SYNC_PAUSE_DURATION_MS,
        "autoSyncFailureThresholdMin": settings.AUTO_SYNC_FAILURE_THRESHOLD_MIN,
        "embeddingsChunkSize": settings.EMBEDDINGS_CHUNK_SIZE,
        "embeddingsBackfillLimitDefault": settings.EMBEDDINGS_BACKFILL_LIMIT_DEFAULT,
        "translationBatchLimit": settings.TRANSLATION_BATCH_LIMIT,
        "translationBatchMaxChars": settings.TRANSLATION_BATCH_MAX_CHARS,
        "environment": settings.ENVIRONMENT,
    }


def build_runtime_config(
    session: Session,
    *,
    user_id: uuid.UUID | None = None,
    now_ms: int | None = None,
) -> dict[str, Any]:
    """Return effective runtime settings merged from DB AppSettings and env defaults."""
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    sync_settings = load_sync_settings(session)
    retention_settings = load_retention_settings(session)
    effective_global_start_time_ms = compute_effective_global_start_time_ms(
        sync_settings, retention_settings, now_ms=now
    )
    scrape_cutoff_ms = compute_scrape_cutoff_ms(
        sync_settings, retention_settings, now_ms=now
    )
    sync_payload = _sync_runtime_payload(sync_settings)
    network_payload = _network_runtime_payload(session, user_id)
    configured_concurrency = sync_payload["syncConcurrency"]
    effective_capacity = network_payload.get("effectiveProxyCapacity")
    allowed_concurrency = (
        min(configured_concurrency, effective_capacity)
        if effective_capacity
        else configured_concurrency
    )
    active_sync_job = get_active_sync_job_summary(
        allowed_concurrency=allowed_concurrency,
        effective_proxy_capacity=effective_capacity,
    )

    return {
        "nowMs": now,
        "scrapeCutoffMs": scrape_cutoff_ms,
        "effectiveGlobalStartTimeMs": effective_global_start_time_ms,
        "globalStartTime": {
            "mode": sync_payload["globalStartTimeMode"],
            "value": sync_payload["globalStartTimeValue"],
            "effectiveMs": effective_global_start_time_ms,
        },
        "sync": sync_payload,
        "scraper": {
            "maxPostsPerChannel": settings.SCRAPER_MAX_POSTS_PER_CHANNEL,
            "iterationLimit": settings.SCRAPER_ITERATION_LIMIT,
        },
        "retention": {
            "postRetentionDays": int(
                retention_settings.get("postRetentionDays")
                or settings.RETENTION_POST_DAYS_DEFAULT
            ),
            "logRetentionDays": int(
                retention_settings.get("logRetentionDays")
                or settings.RETENTION_LOG_DAYS_DEFAULT
            ),
        },
        "network": network_payload,
        "jobs": _jobs_runtime_payload(session),
        "constants": _constants_payload(),
        "activeSyncJob": active_sync_job,
    }
