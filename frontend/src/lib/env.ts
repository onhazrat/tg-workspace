function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStringEnv(value: string | undefined, fallback: string): string {
  if (value === undefined || value === "") return fallback;
  return value;
}

/** Vite build-time tunables — see root `.env.example` for documentation. */
export const env = {
  syncJobTimeoutMs: parseIntEnv(
    import.meta.env.VITE_SYNC_JOB_TIMEOUT_MS,
    30 * 60 * 1000,
  ),
  syncJobFallbackPollMs: parseIntEnv(
    import.meta.env.VITE_SYNC_JOB_FALLBACK_POLL_MS,
    1000,
  ),
  ragStatusPollMs: parseIntEnv(import.meta.env.VITE_RAG_STATUS_POLL_MS, 10_000),
  apiHealthPollMs: parseIntEnv(
    import.meta.env.VITE_API_HEALTH_POLL_MS,
    30_000,
  ),
  translationDebounceMs: parseIntEnv(
    import.meta.env.VITE_TRANSLATION_DEBOUNCE_MS,
    1000,
  ),
  translationMaxBatchChars: parseIntEnv(
    import.meta.env.VITE_TRANSLATION_MAX_BATCH_CHARS,
    4000,
  ),
  autoSyncIntervalDefault: parseIntEnv(
    import.meta.env.VITE_AUTO_SYNC_INTERVAL_DEFAULT,
    60,
  ),
  defaultAiModel: parseStringEnv(
    import.meta.env.VITE_DEFAULT_AI_MODEL,
    "gemini-3-flash-preview",
  ),
  defaultAiLanguage: parseStringEnv(
    import.meta.env.VITE_DEFAULT_AI_LANGUAGE,
    "English",
  ),
  queryStaleTimeMs: parseIntEnv(
    import.meta.env.VITE_QUERY_STALE_TIME_MS,
    30_000,
  ),
  /** Minimum interval between GET /sync-meta calls (ms). */
  syncMetaMinIntervalMs: parseIntEnv(
    import.meta.env.VITE_SYNC_META_MIN_INTERVAL_MS,
    5_000,
  ),
} as const;
