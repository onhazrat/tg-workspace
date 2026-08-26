import { z } from "zod"
import {
  AUTO_SYNC_INTERVAL_DEFAULT,
  DEFAULT_AI_LANGUAGE,
  DEFAULT_MODEL,
  DYNAMIC_SYNC_EXPECTED_POSTS_DEFAULT,
  LANGUAGES,
  MODELS,
  RETENTION_LOG_DAYS_DEFAULT,
  RETENTION_PAYLOAD_DAYS_DEFAULT,
  RETENTION_POST_DAYS_DEFAULT,
  RETENTION_REPORT_DAYS_DEFAULT,
  RETENTION_REPORT_MAX_DEFAULT,
  RETENTION_SHARED_LOG_DAYS_DEFAULT,
} from "@/constants"
import type {
  DiscoverFollowState,
  DiscoverSortKey,
  DiscoverySignalKind,
} from "@/lib/posts/discover-candidates"
import { DEFAULT_DISCOVER_SIGNAL_WEIGHTS } from "@/lib/posts/discover-candidates"
import type { GlobalStartTimeMode, GlobalStartTimeValue } from "@/types"

/** Backend settings sections pushed via api.putSetting(section, payload). */
export type BackendSection = "sync" | "retention" | "translation"

export interface SettingSpec<T> {
  /** Storage key — must stay identical to the historical key for back-compat.
   *  `scopedStorage` prefixes it per account; the name here is the unprefixed one. */
  storageKey: string
  /** Older storage keys consulted when the primary key is absent or invalid. */
  legacyStorageKeys?: readonly string[]
  /** Older server payload keys consulted when the primary key is absent or invalid. */
  serverLegacyKeys?: readonly string[]
  /** Validates decoded stored values and raw server values alike. */
  schema: z.ZodType<T>
  defaultValue: T
  /** Raw stored string -> candidate value (then validated by `schema`). */
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

/** String-union setting stored verbatim. */
const enumSetting = <T extends string>(
  storageKey: string,
  schema: z.ZodType<T>,
  defaultValue: T,
  options: SpecOptions = {},
): SettingSpec<T> => ({
  storageKey,
  schema,
  defaultValue,
  decode: (raw) => raw,
  encode: (value) => value,
  ...options,
})

/**
 * String setting restricted to a runtime-derived option list (model ids, language
 * names). `enumSetting` needs a literal tuple, which these lists are not, so
 * membership is checked with a refinement instead.
 *
 * The point is the rejection: `loadSetting` falls back to `defaultValue` when the
 * schema rejects, so a value that is no longer offered — a model id persisted
 * before the model list changed — resolves to the default instead of surviving as
 * a value that matches no control option and renders as nothing selected.
 */
const oneOfSetting = (
  storageKey: string,
  allowedValues: readonly string[],
  defaultValue: string,
  options: SpecOptions = {},
): SettingSpec<string> => ({
  storageKey,
  schema: z.string().refine((value) => allowedValues.includes(value)),
  defaultValue,
  decode: (raw) => raw,
  encode: (value) => value,
  ...options,
})

const MODEL_IDS = MODELS.map((model) => model.id)

/** JSON-encoded setting for non-scalar values (arrays, records). */
const jsonSetting = <T>(
  storageKey: string,
  schema: z.ZodType<T>,
  defaultValue: T,
  options: SpecOptions = {},
): SettingSpec<T> => ({
  storageKey,
  schema,
  defaultValue,
  decode: (raw) => {
    try {
      return JSON.parse(raw)
    } catch (_e) {
      return undefined
    }
  },
  encode: (value) => JSON.stringify(value),
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

// Persistence note: historically only some of these keys had a persist-to-storage
// effect; the store now persists EVERY key on change (benign unification — the
// backend-synced keys still hydrate from the server, browser storage is a fallback).
export const appSettingsSpec = {
  aiLanguage: oneOfSetting("aiLanguage", LANGUAGES, DEFAULT_AI_LANGUAGE),
  selectedModel: oneOfSetting("selectedModel", MODEL_IDS, DEFAULT_MODEL),
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
  // Your own publish/LLM/embedding rows. Personal since ticket 20: the server
  // stores it per account, so a short window here never reaches anybody else's
  // evidence. The wire shape is unchanged — the endpoint is a facade.
  logRetentionDays: intSetting("logRetentionDays", RETENTION_LOG_DAYS_DEFAULT, {
    section: "retention",
  }),
  // The log rows no account owns: sync (Channel telemetry), network (proxy
  // behaviour), and anything a background job wrote with no user behind it.
  // Deployment policy, so only an Admin's save of it is honoured.
  sharedLogRetentionDays: intSetting(
    "sharedLogRetentionDays",
    RETENTION_SHARED_LOG_DAYS_DEFAULT,
    {
      section: "retention",
    },
  ),
  // Sync log request/response bodies live in their own table so they can be
  // reclaimed without touching the log rows, which is why they get a shorter
  // window than logRetentionDays above: a long audit trail stays cheap.
  payloadRetentionDays: intSetting(
    "payloadRetentionDays",
    RETENTION_PAYLOAD_DAYS_DEFAULT,
    {
      section: "retention",
    },
  ),
  // Saved Discover reports, capped two ways: by age and by count. Both are
  // server-only — unlike post/log retention, nothing in the browser cache
  // mirrors a report — but they live in the schema so the operator can reach
  // them, since 0 (disable) is the documented escape hatch and the retention job
  // has no floor guard that would keep the newest report regardless.
  reportRetentionDays: intSetting(
    "reportRetentionDays",
    RETENTION_REPORT_DAYS_DEFAULT,
    { section: "retention" },
  ),
  reportRetentionMax: intSetting(
    "reportRetentionMax",
    RETENTION_REPORT_MAX_DEFAULT,
    { section: "retention" },
  ),
  translationEnabled: booleanSetting("translationEnabled", false, {
    section: "translation",
  }),
  autoTranslate: booleanSetting("autoTranslate", false, {
    section: "translation",
  }),
  translationModel: oneOfSetting("translationModel", MODEL_IDS, DEFAULT_MODEL, {
    section: "translation",
  }),
  translationTargetLanguage: oneOfSetting(
    "translationTargetLanguage",
    LANGUAGES,
    DEFAULT_AI_LANGUAGE,
    { section: "translation" },
  ),
  // Discover tab candidate filters (local only — never mirrored to the backend).
  discoverSignals: jsonSetting(
    "discoverSignals",
    z.array(z.enum(["forward", "mention", "link"])),
    ["forward", "mention", "link"] as DiscoverySignalKind[],
  ),
  discoverSortKey: enumSetting<DiscoverSortKey>(
    "discoverSortKey",
    z.enum([
      "total",
      "weighted",
      "forward",
      "mention",
      "link",
      "lastSeen",
      "seenInCount",
      "subscribers",
    ]),
    "total",
  ),
  // Per-kind weights for the "Weighted" sort. Editable because the right
  // trade-off is corpus-specific: a forward is normally the strongest
  // endorsement and a bare @mention the weakest, but how much stronger is a
  // judgement only the operator can make. Applied client-side over the saved
  // report, so changing them re-ranks instantly without regenerating.
  discoverSignalWeights: jsonSetting(
    "discoverSignalWeights",
    z.object({
      forward: z.number(),
      mention: z.number(),
      link: z.number(),
    }),
    DEFAULT_DISCOVER_SIGNAL_WEIGHTS,
  ),
  // "all" preserves the historical Discover behaviour of listing followed
  // sources too (rendered with a "Following" badge and a disabled checkbox).
  discoverFollowState: enumSetting<DiscoverFollowState>(
    "discoverFollowState",
    z.enum(["all", "unfollowed", "followed", "ignored"]),
    "all",
  ),
  discoverMinTotal: intSetting("discoverMinTotal", 1),
  // Workspace chrome (local only — never mirrored to the backend).
  //
  // `workspaceFocusMode` persists but native browser fullscreen does not, and
  // cannot: `requestFullscreen` needs a user gesture, so a reload restores the
  // collapsed chrome without the browser being fullscreen. That asymmetry is
  // deliberate — see `hooks/useWorkspaceFullscreen.ts`.
  workspaceFocusMode: booleanSetting("workspaceFocusMode", false),
  compactWorkspaceTabs: booleanSetting("compactWorkspaceTabs", false),
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
