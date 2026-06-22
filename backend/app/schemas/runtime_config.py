from pydantic import BaseModel, Field


class GlobalStartTimeSnapshot(BaseModel):
    mode: str
    value: str | int | float | None = None
    effective_ms: int = Field(..., alias="effectiveMs")

    model_config = {"populate_by_name": True}


class SyncRuntimeSettings(BaseModel):
    auto_sync_enabled: bool = Field(..., alias="autoSyncEnabled")
    auto_sync_interval: int = Field(..., alias="autoSyncInterval")
    sync_concurrency: int = Field(..., alias="syncConcurrency")
    consecutive_failures: int = Field(..., alias="consecutiveFailures")
    auto_sync_pause_until: int | None = Field(None, alias="autoSyncPauseUntil")
    global_start_time_mode: str | None = Field(None, alias="globalStartTimeMode")
    global_start_time_value: str | int | float | None = Field(
        None, alias="globalStartTimeValue"
    )

    model_config = {"populate_by_name": True}


class ScraperRuntimeSettings(BaseModel):
    max_posts_per_channel: int = Field(..., alias="maxPostsPerChannel")
    iteration_limit: int = Field(..., alias="iterationLimit")

    model_config = {"populate_by_name": True}


class ProxyLaneSnapshot(BaseModel):
    proxy_url: str = Field(..., alias="proxyUrl")
    max_parallel: int = Field(..., alias="maxParallel")
    in_use: int = Field(..., alias="inUse")
    in_cooldown: bool = Field(..., alias="inCooldown")

    model_config = {"populate_by_name": True}


class NetworkRuntimeSettings(BaseModel):
    proxy_enabled: bool = Field(False, alias="proxyEnabled")
    proxy_urls: list[str] = Field(default_factory=list, alias="proxyUrls")
    proxy_default_concurrency: int = Field(1, alias="proxyDefaultConcurrency")
    proxy_concurrency_overrides: dict[str, int] = Field(
        default_factory=dict, alias="proxyConcurrencyOverrides"
    )
    effective_proxy_capacity: int = Field(0, alias="effectiveProxyCapacity")
    proxy_lanes: list[ProxyLaneSnapshot] = Field(
        default_factory=list, alias="proxyLanes"
    )
    tor_enabled: bool = Field(False, alias="torEnabled")
    tor_mode: str | None = Field(None, alias="torMode")
    tor_proxy_urls: str | None = Field(None, alias="torProxyUrls")
    tor_rotation_strategy: str | None = Field(None, alias="torRotationStrategy")
    tor_control_enabled: bool = Field(False, alias="torControlEnabled")
    tor_control_port: int | None = Field(None, alias="torControlPort")
    tor_auto_rotate: bool = Field(False, alias="torAutoRotate")
    tor_rotation_threshold: int = Field(..., alias="torRotationThreshold")
    env_fallback_configured: bool = Field(..., alias="envFallbackConfigured")
    using_env_fallback: bool = Field(..., alias="usingEnvFallback")
    tor_available: bool = Field(..., alias="torAvailable")
    tor_socks_proxy: str = Field(..., alias="torSocksProxy")
    effective_tor_enabled: bool = Field(..., alias="effectiveTorEnabled")
    resolved_proxy_count: int = Field(..., alias="resolvedProxyCount")
    resolved_proxies: list[str] = Field(default_factory=list, alias="resolvedProxies")
    fetch_timeout_seconds: float = Field(..., alias="fetchTimeoutSeconds")
    fetch_retries: int = Field(..., alias="fetchRetries")
    fetch_initial_delay_ms: int = Field(..., alias="fetchInitialDelayMs")
    proxy_cooldown_ms: int = Field(..., alias="proxyCooldownMs")
    telegram_api_retries: int = Field(..., alias="telegramApiRetries")
    telegram_api_initial_delay_ms: int = Field(..., alias="telegramApiInitialDelayMs")

    model_config = {"populate_by_name": True}


class JobIntervals(BaseModel):
    auto_sync_check_seconds: int = Field(..., alias="autoSyncCheckSeconds")
    embeddings_seconds: int = Field(..., alias="embeddingsSeconds")
    auto_summary_seconds: int = Field(..., alias="autoSummarySeconds")
    retention_hours: int = Field(..., alias="retentionHours")
    translation_batch_seconds: int = Field(..., alias="translationBatchSeconds")

    model_config = {"populate_by_name": True}


class JobsRuntimeSettings(BaseModel):
    enabled: dict[str, bool]
    intervals: JobIntervals

    model_config = {"populate_by_name": True}


class RetentionRuntimeSettings(BaseModel):
    post_retention_days: int = Field(..., alias="postRetentionDays")
    log_retention_days: int = Field(..., alias="logRetentionDays")

    model_config = {"populate_by_name": True}


class RuntimeConstants(BaseModel):
    sync_max_retries: int = Field(..., alias="syncMaxRetries")
    sync_retry_backoff_base_ms: int = Field(..., alias="syncRetryBackoffBaseMs")
    sync_job_sse_throttle_ms: int = Field(..., alias="syncJobSseThrottleMs")
    sync_job_persist_interval_ms: int = Field(..., alias="syncJobPersistIntervalMs")
    auto_sync_pause_duration_ms: int = Field(..., alias="autoSyncPauseDurationMs")
    auto_sync_failure_threshold_min: int = Field(
        ..., alias="autoSyncFailureThresholdMin"
    )
    embeddings_chunk_size: int = Field(..., alias="embeddingsChunkSize")
    embeddings_backfill_limit_default: int = Field(
        ..., alias="embeddingsBackfillLimitDefault"
    )
    translation_batch_limit: int = Field(..., alias="translationBatchLimit")
    translation_batch_max_chars: int = Field(..., alias="translationBatchMaxChars")
    environment: str

    model_config = {"populate_by_name": True}


class ActiveSyncJobSummary(BaseModel):
    job_id: str = Field(..., alias="jobId")
    status: str
    source: str
    channel_count: int = Field(..., alias="channelCount")
    running_channels: int = Field(..., alias="runningChannels")
    pending_channels: int = Field(..., alias="pendingChannels")
    allowed_concurrency: int = Field(..., alias="allowedConcurrency")
    concurrency_in_use: int = Field(..., alias="concurrencyInUse")
    effective_proxy_capacity: int | None = Field(None, alias="effectiveProxyCapacity")

    model_config = {"populate_by_name": True}


class RuntimeConfigResponse(BaseModel):
    now_ms: int = Field(..., alias="nowMs")
    scrape_cutoff_ms: int = Field(..., alias="scrapeCutoffMs")
    effective_global_start_time_ms: int = Field(..., alias="effectiveGlobalStartTimeMs")
    global_start_time: GlobalStartTimeSnapshot = Field(..., alias="globalStartTime")
    sync: SyncRuntimeSettings
    scraper: ScraperRuntimeSettings
    network: NetworkRuntimeSettings
    jobs: JobsRuntimeSettings
    retention: RetentionRuntimeSettings
    constants: RuntimeConstants
    active_sync_job: ActiveSyncJobSummary | None = Field(None, alias="activeSyncJob")

    model_config = {"populate_by_name": True}
