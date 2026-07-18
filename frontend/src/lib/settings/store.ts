import {
  type AppSettingKey,
  type AppSettings,
  appSettingKeys,
  appSettingsSpec,
  type BackendSection,
  specFor,
} from "./schema"

/** Minimal read interface — localStorage-compatible, or a plain record for tests. */
export interface SettingsReader {
  getItem(key: string): string | null
}

/** Minimal write interface — localStorage-compatible, or a plain record for tests. */
export interface SettingsWriter {
  setItem(key: string, value: string): void
}

export function readerFromRecord(
  record: Record<string, string>,
): SettingsReader {
  return { getItem: (key) => (key in record ? (record[key] ?? null) : null) }
}

function assignSetting<K extends AppSettingKey>(
  target: Partial<AppSettings>,
  key: K,
  value: AppSettings[K],
): void {
  target[key] = value
}

/**
 * Read one setting: primary storage key first, then legacy keys, falling back
 * to the schema default when absent or invalid.
 */
export function loadSetting<K extends AppSettingKey>(
  key: K,
  storage: SettingsReader,
): AppSettings[K] {
  const spec = specFor(key)
  for (const storageKey of [
    spec.storageKey,
    ...(spec.legacyStorageKeys ?? []),
  ]) {
    const raw = storage.getItem(storageKey)
    if (raw === null) continue
    const parsed = spec.schema.safeParse(spec.decode(raw))
    if (parsed.success) return parsed.data
  }
  return spec.defaultValue
}

export function loadAppSettings(storage: SettingsReader): AppSettings {
  const settings = {} as AppSettings
  for (const key of appSettingKeys) {
    assignSetting(settings, key, loadSetting(key, storage))
  }
  return settings
}

/** Write settings to storage; when `prev` is given, only changed keys are written. */
export function persistAppSettings(
  next: AppSettings,
  storage: SettingsWriter,
  prev?: AppSettings,
): void {
  for (const key of appSettingKeys) {
    if (prev && Object.is(prev[key], next[key])) continue
    const spec = specFor(key)
    storage.setItem(spec.storageKey, spec.encode(next[key]))
  }
}

export function sectionKeys(section: BackendSection): AppSettingKey[] {
  return appSettingKeys.filter(
    (key) => appSettingsSpec[key].section === section,
  )
}

/** Payload pushed to api.putSetting(section, ...) — key order matches the schema. */
export function buildSectionPayload(
  section: BackendSection,
  settings: AppSettings,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const key of sectionKeys(section)) {
    payload[key] = settings[key]
  }
  return payload
}

/** Values of a section in schema order — usable as a React effect deps array. */
export function sectionValues(
  section: BackendSection,
  settings: AppSettings,
): unknown[] {
  return sectionKeys(section).map((key) => settings[key])
}

/**
 * Validated server-payload -> state merge for one section. Absent or malformed
 * fields are ignored; server legacy keys (e.g. "autoSyncInterval") are consulted
 * when the primary key is missing or invalid.
 */
export function decodeServerSection(
  section: BackendSection,
  value: Record<string, unknown>,
): Partial<AppSettings> {
  const updates: Partial<AppSettings> = {}
  for (const key of sectionKeys(section)) {
    const spec = specFor(key)
    for (const serverKey of [key, ...(spec.serverLegacyKeys ?? [])]) {
      if (value[serverKey] === undefined) continue
      const parsed = spec.schema.safeParse(value[serverKey])
      if (parsed.success) {
        assignSetting(updates, key, parsed.data)
        break
      }
    }
  }
  return updates
}

export type AppSettingSetters = {
  [K in AppSettingKey as `set${Capitalize<K>}`]: (value: AppSettings[K]) => void
}

function makeSetter<K extends AppSettingKey>(
  key: K,
  applyUpdate: (updater: (prev: AppSettings) => AppSettings) => void,
): (value: AppSettings[K]) => void {
  return (value) =>
    applyUpdate((prev) => {
      if (Object.is(prev[key], value)) return prev
      const next = { ...prev }
      next[key] = value
      return next
    })
}

/**
 * Build one setter per setting (setAiLanguage, setSyncConcurrency, ...). Call once —
 * the returned functions have stable identity for the provider's lifetime.
 */
export function createAppSettingSetters(
  applyUpdate: (updater: (prev: AppSettings) => AppSettings) => void,
): AppSettingSetters {
  const setters: Record<string, unknown> = {}
  for (const key of appSettingKeys) {
    const name = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`
    setters[name] = makeSetter(key, applyUpdate)
  }
  return setters as unknown as AppSettingSetters
}
