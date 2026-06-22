/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_API_KEY: string
  readonly VITE_SYNC_JOB_TIMEOUT_MS?: string
  readonly VITE_SYNC_JOB_FALLBACK_POLL_MS?: string
  readonly VITE_RAG_STATUS_POLL_MS?: string
  readonly VITE_API_HEALTH_POLL_MS?: string
  readonly VITE_TRANSLATION_DEBOUNCE_MS?: string
  readonly VITE_TRANSLATION_MAX_BATCH_CHARS?: string
  readonly VITE_AUTO_SYNC_INTERVAL_DEFAULT?: string
  readonly VITE_DEFAULT_AI_MODEL?: string
  readonly VITE_DEFAULT_AI_LANGUAGE?: string
  readonly VITE_QUERY_STALE_TIME_MS?: string
  readonly VITE_SYNC_META_MIN_INTERVAL_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
