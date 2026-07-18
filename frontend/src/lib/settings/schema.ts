import { z } from "zod"
import {
  AUTO_SYNC_INTERVAL_DEFAULT,
  DEFAULT_AI_LANGUAGE,
  DEFAULT_MODEL,
  DYNAMIC_SYNC_EXPECTED_POSTS_DEFAULT,
  RETENTION_LOG_DAYS_DEFAULT,
  RETENTION_POST_DAYS_DEFAULT,
} from "@/constants"
import type { GlobalStartTimeMode, GlobalStartTimeValue } from "@/types"

/** Backend settings sections pushed via api.putSetting(section, payload). */
export type BackendSection = "sync" | "retention" | "translation"

export interface SettingSpec<T> {
  /** localStorage key — must stay identical to the historical key for back-compat. */
  storageKey: string
  /** Older localStorage keys consulted when the primary key is absent or invalid. */
  legacyStorageKeys?: readonly string[]
  /** Older server payload keys consulted when the primary key is absent or invalid. */
  serverLegacyKeys?: readonly string[]
  /** Validates decoded localStorage values and raw server values alike. */
  schema: z.ZodType<T>
  defaultValue: T
  /** Raw localStorage string -> candidate value (then validated by `schema`). */
  decode: (raw: string) => unknown
  encode: (value: T) => string
  /** Backend section this key is mirrored to, if any. */
  section?: BackendSection
}

interface SpecOptions {
  legacyStorageKeys?: readonly string[]
  serverLegacyKeys?: readonly string[]
  section?: BackendSection
}

const stringSetting = (
  storageKey: string,
  defaultValue: string,
  options: SpecOptions = {},
): SettingSpec<string> => ({
  storageKey,
  // min(1) mirrors the historical `localStorage.getItem(key) || default` fallback
  schema: z.string().min(1),
  defaultValue,
  decode: (raw) => raw,
  encode: (value) => value,
  ...options,
})

const booleanSetting = (
  storageKey: string,
  defaultValue: boolean,
  options: SpecOptions = {},
): SettingSpec<boolean> => ({
  storageKey,
  schema: z.boolean(),
  defaultValue,
  // Historical format: any stored value other than "true" reads as false
  decode: (raw) => raw === "true",
  encode: (value) => String(value),
  ...options,
})

const intSetting = (
  storageKey: string,
  defaultValue: number,
  options: SpecOptions = {},
): SettingSpec<number> => ({
  storageKey,
  schema: z.number(),
  defaultValue,
  decode: (raw) => Number.parseInt(raw, 10),
  encode: (value) => String(value),
  ...options,
})

const floatSetting = (
  storageKey: string,
  defaultValue: number,
  options: SpecOptions = {},
): SettingSpec<number> => ({
  storageKey,
  schema: z.number(),
  defaultValue,
  decode: (raw) => Number.parseFloat(raw),
  encode: (value) => String(value),
  ...options,
})

const globalStartTimeModeSetting: SettingSpec<GlobalStartTimeMode> = {
  storageKey: "globalStartTimeMode",
  schema: z.enum(["relative", "absolute", "retention"]),
  defaultValue: "retention",
  decode: (raw) => raw,
  encode: (value) => value,
  section: "sync",
}

const globalStartTimeValueSetting: SettingSpec<GlobalStartTimeValue> = {
  storageKey: "globalStartTimeValue",
  schema: z.union([z.number(), z.string(), z.null()]),
  defaultValue: null,
  decode: (raw) => {
    try {
      return JSON.parse(raw)
    } catch (_e) {
      return undefined
    }
  },
  encode: (value) => JSON.stringify(value),
  section: "sync",
}

// Persistence note: historically only some of these keys had a persist-to-localStorage
// effect; the store now persists EVERY key on change (benign unification — the
// backend-synced keys still hydrate from the server, localStorage is a fallback).
export const appSettingsSpec = {
  aiLanguage: stringSetting("aiLanguage", DEFAULT_AI_LANGUAGE),
  selectedModel: stringSetting("selectedModel", DEFAULT_MODEL),
  aiTemperature: floatSetting("aiTemperature", 0.7),
  embeddingsEnabled: booleanSetting("embeddingsEnabled", false),
  embeddingsPaused: booleanSetting("embeddingsPaused", false),
  showChannelBio: booleanSetting("showChannelBio", true),
  showChannelSubscribers: booleanSetting("showChannelSubscribers", true),
  showChannelTelegramChatId: booleanSetting("showChannelTelegramChatId", false),
  showChannelPhotos: booleanSetting("showChannelPhotos", false),
  showChannelVideos: booleanSetting("showChannelVideos", false),
  showChannelFiles: booleanSetting("showChannelFiles", false),
  showChannelLinks: booleanSetting("showChannelLinks", false),
  showChannelStartId: booleanSetting("showChannelStartId", false),
  regularSyncIntervalMinutes: intSetting(
    "regularSyncIntervalMinutes",
    AUTO_SYNC_INTERVAL_DEFAULT,
    {
      legacyStorageKeys: ["autoSyncInterval"],
      serverLegacyKeys: ["autoSyncInterval"],
      section: "sync",
    },
  ),
  dynamicSyncEnabledDefault: booleanSetting(
    "dynamicSyncEnabledDefault",
    false,
    {
      section: "sync",
    },
  ),
  dynamicSyncExpectedPostsDefault: intSetting(
    "dynamicSyncExpectedPostsDefault",
    DYNAMIC_SYNC_EXPECTED_POSTS_DEFAULT,
    { section: "sync" },
  ),
  syncFailureBackoffMinutes: intSetting("syncFailureBackoffMinutes", 5, {
    section: "sync",
  }),
  syncConcurrency: intSetting("syncConcurrency", 3, { section: "sync" }),
  globalStartTimeMode: globalStartTimeModeSetting,
  globalStartTimeValue: globalStartTimeValueSetting,
  postRetentionDays: intSetting(
    "postRetentionDays",
    RETENTION_POST_DAYS_DEFAULT,
    {
      section: "retention",
    },
  ),
  logRetentionDays: intSetting("logRetentionDays", RETENTION_LOG_DAYS_DEFAULT, {
    section: "retention",
  }),
  translationEnabled: booleanSetting("translationEnabled", false, {
    section: "translation",
  }),
  autoTranslate: booleanSetting("autoTranslate", false, {
    section: "translation",
  }),
  translationModel: stringSetting("translationModel", DEFAULT_MODEL, {
    section: "translation",
  }),
  translationTargetLanguage: stringSetting(
    "translationTargetLanguage",
    DEFAULT_AI_LANGUAGE,
    { section: "translation" },
  ),
}

/** State shape derived from the schema — one property per setting. */
export type AppSettings = {
  [K in keyof typeof appSettingsSpec]: (typeof appSettingsSpec)[K] extends SettingSpec<
    infer T
  >
    ? T
    : never
}

export type AppSettingKey = keyof AppSettings

/** Keys in declaration order (drives payload key order for backend sections). */
export const appSettingKeys = Object.keys(appSettingsSpec) as AppSettingKey[]

export function specFor<K extends AppSettingKey>(
  key: K,
): SettingSpec<AppSettings[K]> {
  return appSettingsSpec[key] as SettingSpec<AppSettings[K]>
}
