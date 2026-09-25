import {
  RETENTION_LOG_DAYS_DEFAULT,
  RETENTION_PAYLOAD_DAYS_DEFAULT,
  RETENTION_POST_DAYS_DEFAULT,
  RETENTION_SHARED_LOG_DAYS_DEFAULT,
} from "@/constants"
import type { AppSettings } from "./schema"
import { decodeServerSection } from "./store"

type Section = Record<string, unknown>

export type HydrationRows = {
  sync: Section | null | undefined
  retention: Section | null | undefined
  translation: Section | null | undefined
  jobsStatus: Record<string, { enabled?: unknown }> | null
}

export type Hydration = {
  updates: Partial<AppSettings>
  /** The server sections with legacy browser values merged in, or null when
   * nothing legacy was found and there is nothing to write back. */
  writeBack: { sync: Section; retention: Section } | null
}

/** A legacy stored integer, keyed by its server field, unless the server has one. */
function legacyInt(
  storage: { getItem(key: string): string | null },
  storageKey: string,
  section: Section,
  field: string,
): Section {
  const stored = storage.getItem(storageKey)
  if (stored === null || section[field] !== undefined) return {}
  return { [field]: Number.parseInt(stored, 10) }
}

/**
 * Merge the server's backend-synced sections with the legacy values an older
 * build kept in browser storage. The server wins wherever it has a value.
 */
export function hydrateAppSettings(
  rows: HydrationRows,
  storage: { getItem(key: string): string | null },
): Hydration {
  const sync = rows.sync ?? {}
  const retention = rows.retention ?? {}
  const legacySync = legacyInt(
    storage,
    "autoSyncInterval",
    sync,
    "regularSyncIntervalMinutes",
  )
  const legacyRetention = legacyInt(
    storage,
    "postRetentionDays",
    retention,
    "postRetentionDays",
  )
  const updates: Partial<AppSettings> = {
    ...decodeServerSection("sync", { ...sync, ...legacySync }),
    ...decodeServerSection("retention", {
      postRetentionDays: RETENTION_POST_DAYS_DEFAULT,
      logRetentionDays: RETENTION_LOG_DAYS_DEFAULT,
      sharedLogRetentionDays: RETENTION_SHARED_LOG_DAYS_DEFAULT,
      payloadRetentionDays: RETENTION_PAYLOAD_DAYS_DEFAULT,
      ...retention,
      ...legacyRetention,
    }),
    ...decodeServerSection("translation", rows.translation ?? {}),
  }
  const embeddings = rows.jobsStatus?.embeddings?.enabled
  if (typeof embeddings === "boolean") updates.embeddingsEnabled = embeddings
  const hasLegacy =
    Object.keys(legacySync).length > 0 ||
    Object.keys(legacyRetention).length > 0
  return {
    updates,
    writeBack: hasLegacy
      ? {
          sync: { ...sync, ...legacySync },
          retention: { ...retention, ...legacyRetention },
        }
      : null,
  }
}
