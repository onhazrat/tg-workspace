function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseStringEnv(value: string | undefined, fallback: string): string {
  if (value === undefined || value === "") return fallback
  return value
}

const viteEnv = typeof import.meta !== "undefined" ? import.meta.env : undefined

/** Vite build-time tunables — see root `.env.example` for documentation. */
export const env = {
  syncJobTimeoutMs: parseIntEnv(
    viteEnv?.VITE_SYNC_JOB_TIMEOUT_MS,
    30 * 60 * 1000,
  ),
  syncJobFallbackPollMs: parseIntEnv(
    viteEnv?.VITE_SYNC_JOB_FALLBACK_POLL_MS,
    1000,
  ),
  ragStatusPollMs: parseIntEnv(viteEnv?.VITE_RAG_STATUS_POLL_MS, 10_000),
  apiHealthPollMs: parseIntEnv(viteEnv?.VITE_API_HEALTH_POLL_MS, 30_000),
  translationDebounceMs: parseIntEnv(
    viteEnv?.VITE_TRANSLATION_DEBOUNCE_MS,
    1000,
  ),
  translationMaxBatchChars: parseIntEnv(
    viteEnv?.VITE_TRANSLATION_MAX_BATCH_CHARS,
    4000,
  ),
  autoSyncIntervalDefault: parseIntEnv(
    viteEnv?.VITE_AUTO_SYNC_INTERVAL_DEFAULT,
    60,
  ),
  retentionPostDaysDefault: parseIntEnv(
    viteEnv?.VITE_RETENTION_POST_DAYS_DEFAULT,
    90,
  ),
  retentionLogDaysDefault: parseIntEnv(
    viteEnv?.VITE_RETENTION_LOG_DAYS_DEFAULT,
    30,
  ),
  defaultAiModel: parseStringEnv(
    viteEnv?.VITE_DEFAULT_AI_MODEL,
    "gemini-3-flash-preview",
  ),
  defaultAiLanguage: parseStringEnv(
    viteEnv?.VITE_DEFAULT_AI_LANGUAGE,
    "English",
  ),
  queryStaleTimeMs: parseIntEnv(viteEnv?.VITE_QUERY_STALE_TIME_MS, 30_000),
  /** Minimum interval between GET /sync-meta calls (ms). */
  syncMetaMinIntervalMs: parseIntEnv(
    viteEnv?.VITE_SYNC_META_MIN_INTERVAL_MS,
    5_000,
  ),
  /** Max recent commands shown in palette when search is empty. */
  commandPaletteRecentCount: parseIntEnv(
    viteEnv?.VITE_COMMAND_PALETTE_RECENT_COUNT,
    5,
  ),
} as const
