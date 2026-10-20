import {
  RETENTION_LOG_DAYS_DEFAULT,
  RETENTION_PAYLOAD_DAYS_DEFAULT,
  RETENTION_POST_DAYS_DEFAULT,
  RETENTION_SHARED_LOG_DAYS_DEFAULT,
} from "@/constants"
import { type AppSettings, specFor } from "./schema"
import { decodeServerSection, sectionKeys } from "./store"

type Section = Record<string, unknown>

export type HydrationRows = {
  sync: Section | null | undefined
  retention: Section | null | undefined
  translation: Section | null | undefined
  reach: Section | null | undefined
  publishing?: Section | null
  ai_prefs?: Section | null
  jobsStatus: Record<string, { enabled?: unknown }> | null
}

export type Hydration = {
  updates: Partial<AppSettings>
  /** The server sections with legacy browser values merged in, or null when
   * nothing legacy was found and there is nothing to write back. */
  writeBack: { sync: Section; retention: Section } | null
  /** The AI preferences this browser stored, to upload once because the
   * Account has none (SET-05); null when there is nothing to upload. */
  aiUpload: Partial<AppSettings> | null
}

/**
 * The AI preferences, all three: the Account's when it has any, otherwise
 * what this browser stored before they moved to the Account. The first
 * browser to load uploads its values; every later one finds them there.
 *
 * A field nobody holds is the deployment's, which the server sends under
 * `defaults`; the build's `VITE_*` value is only the guess before it lands.
 */
function aiPreferences(
  { defaults, ...server }: Section,
  storage: { getItem(key: string): string | null },
): Pick<Hydration, "aiUpload"> & { values: Partial<AppSettings> } {
  const stored: Partial<AppSettings> = {}
  for (const key of sectionKeys("ai_prefs")) {
    const spec = specFor(key)
    const raw = storage.getItem(spec.storageKey)
    if (raw === null) continue
    const parsed = spec.schema.safeParse(spec.decode(raw))
    if (parsed.success) Object.assign(stored, { [key]: parsed.data })
  }
  const hasNone = Object.keys(server).length === 0
  const upload = hasNone && Object.keys(stored).length > 0 ? stored : null
  const deployment =
    defaults && typeof defaults === "object" ? (defaults as Section) : {}
  return {
    aiUpload: upload,
    values: {
      ...decodeServerSection("ai_prefs", deployment),
      ...(upload ?? decodeServerSection("ai_prefs", server)),
    },
  }
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
 *
 * The time zone is the one exception: until the account has saved one, it is
 * the browser's (`browserTimeZone`), which the push effect then saves. Once
 * saved, empty included, it is the server's, so travelling does not move it.
 */
export function hydrateAppSettings(
  rows: HydrationRows,
  storage: { getItem(key: string): string | null },
  browserTimeZone = "",
): Hydration {
  const publishing = decodeServerSection("publishing", rows.publishing ?? {})
  const ai = aiPreferences(rows.ai_prefs ?? {}, storage)
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
    ...decodeServerSection("reach", rows.reach ?? {}),
    ...publishing,
    ...ai.values,
    // Absent, not empty: an Account that emptied it chose UTC.
    timeZone:
      typeof rows.publishing?.timeZone === "string"
        ? publishing.timeZone
        : browserTimeZone,
  }
  const embeddings = rows.jobsStatus?.embeddings?.enabled
  if (typeof embeddings === "boolean") updates.embeddingsEnabled = embeddings
  const hasLegacy =
    Object.keys(legacySync).length > 0 ||
    Object.keys(legacyRetention).length > 0
  return {
    updates,
    aiUpload: ai.aiUpload,
    writeBack: hasLegacy
      ? {
          sync: { ...sync, ...legacySync },
          retention: { ...retention, ...legacyRetention },
        }
      : null,
  }
}
