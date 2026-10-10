import { z } from "zod"
import {
  AUTO_SYNC_INTERVAL_DEFAULT,
  DEFAULT_AI_LANGUAGE,
  DEFAULT_MODEL,
  DYNAMIC_SYNC_EXPECTED_POSTS_DEFAULT,
  LANGUAGES,
  RETENTION_LOG_DAYS_DEFAULT,
  RETENTION_PAYLOAD_DAYS_DEFAULT,
  RETENTION_POST_DAYS_DEFAULT,
  RETENTION_REPORT_DAYS_DEFAULT,
  RETENTION_REPORT_MAX_DEFAULT,
  RETENTION_SHARED_LOG_DAYS_DEFAULT,
} from "@/constants"
import { CARD_ZOOM_LEVELS, type CardZoom } from "@/lib/channels/card-zoom"
import {
  ACTION_LIMITS,
  type ActionLimit,
} from "@/lib/channels/selection-regions"
import type {
  DiscoverFollowState,
  DiscoverSortKey,
  DiscoverySignalKind,
} from "@/lib/posts/discover-candidates"
import { DEFAULT_DISCOVER_SIGNAL_WEIGHTS } from "@/lib/posts/discover-candidates"
import type { GlobalStartTimeMode, GlobalStartTimeValue } from "@/types"

/** Backend settings sections pushed via api.putSetting(section, payload). */
export type BackendSection =
  | "sync"
  | "retention"
  | "translation"
  | "reach"
  | "publishing"

/** How Citations read in a Publication (SUMTAB-08); the server applies it. */
export const CITATION_STYLES = ["asWritten", "channelName", "numbered"] as const
export type CitationStyle = (typeof CITATION_STYLES)[number]

export const SUMMARY_TEXT_SIZES = ["S", "M", "L"] as const
export type SummaryTextSize = (typeof SUMMARY_TEXT_SIZES)[number]

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

/**
 * A model id, which is now any non-empty string (BYOK-02).
 *
 * This was `oneOfSetting` over three hardcoded Gemini ids. The membership check
 * had to go with the list: an account on OpenRouter reaches several hundred
 * models, and a refinement the client cannot evaluate would reject every one of
 * them back to the deployment's default — silently, because falling back
 * quietly is exactly what `oneOfSetting` is for.
 *
 * Emptiness is still rejected. An empty model id reaches the provider as a
 * request naming no model and fails there instead of here.
 */
const modelSetting = (
  storageKey: string,
  defaultValue: string,
  options: SpecOptions = {},
): SettingSpec<string> => ({
  storageKey,
  schema: z.string().min(1),
  defaultValue,
  decode: (raw) => raw,
  encode: (value) => value,
  ...options,
})

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

/** Local only: how dense the Channels tab cards are (ZOOM-01). Compact cards
 *  by default, so a first visit shows many Channels and their Last sync. */
const channelCardZoomSetting: SettingSpec<CardZoom> = {
  storageKey: "channelCardZoom",
  schema: z.literal(CARD_ZOOM_LEVELS),
  defaultValue: -1,
  decode: (raw) => Number.parseInt(raw, 10),
  encode: (value) => String(value),
}

/** Local only: whether row 2's actions, Trim and the sort rank reach the
 *  Hidden selection (CTB-04). Shown keeps them off Channels the filters hide. */
const channelActionLimitSetting: SettingSpec<ActionLimit> = {
  storageKey: "channelActionLimit",
  schema: z.enum(ACTION_LIMITS),
  defaultValue: "shown",
  decode: (raw) => raw,
  encode: (value) => value,
}

// Persistence note: historically only some of these keys had a persist-to-storage
// effect; the store now persists EVERY key on change (benign unification — the
// backend-synced keys still hydrate from the server, browser storage is a fallback).
export const appSettingsSpec = {
  aiLanguage: oneOfSetting("aiLanguage", LANGUAGES, DEFAULT_AI_LANGUAGE),
  selectedModel: modelSetting("selectedModel", DEFAULT_MODEL),
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
  channelCardZoom: channelCardZoomSetting,
  // Local only: the Channels grid puts selected first and frozen last (ZOOM-02).
  channelGridGroupBySelection: booleanSetting(
    "channelGridGroupBySelection",
    true,
  ),
  // Local only: the Directory lists the ticked rows first.
  directorySelectedFirst: booleanSetting("directorySelectedFirst", false),
  channelActionLimit: channelActionLimitSetting,
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
  translationModel: modelSetting("translationModel", DEFAULT_MODEL, {
    section: "translation",
  }),
  translationTargetLanguage: oneOfSetting(
    "translationTargetLanguage",
    LANGUAGES,
    DEFAULT_AI_LANGUAGE,
    { section: "translation" },
  ),
  // Reach (REACH-03, ADR-024). Deployment policy stored under the `reach` key,
  // so only an Admin's save is honoured. The server validates the three
  // together and refuses a contradiction with a 422 whose message is shown.
  settlingAgeHours: intSetting("settlingAgeHours", 24, { section: "reach" }),
  estimationFloorHours: intSetting("estimationFloorHours", 3, {
    section: "reach",
  }),
  reachSampleSize: intSetting("reachSampleSize", 100, { section: "reach" }),
  // REACH-07: how often the worker refits the Settling curve.
  curveRefitIntervalHours: intSetting("curveRefitIntervalHours", 24, {
    section: "reach",
  }),
  // Publishing (SUMTAB-08). Personal, stored under the `publishing` key; every
  // send, scheduled ones included, reads them on the server.
  citationStyle: enumSetting<CitationStyle>(
    "citationStyle",
    z.enum(CITATION_STYLES),
    "asWritten",
    { section: "publishing" },
  ),
  linkPreviews: booleanSetting("linkPreviews", false, {
    section: "publishing",
  }),
  // An IANA zone the metadata's time range is written in. Empty until the
  // browser fills it from its own zone, once; after that only Settings moves it.
  timeZone: {
    storageKey: "timeZone",
    schema: z.string(),
    defaultValue: "",
    decode: (raw: string) => raw,
    encode: (value: string) => value,
    section: "publishing",
  } satisfies SettingSpec<string>,
  // The Summary tab's prose size (SUMTAB-03). Local only, per Account through
  // `scopedStorage`.
  summaryTextSize: enumSetting<SummaryTextSize>(
    "summaryTextSize",
    z.enum(SUMMARY_TEXT_SIZES),
    "M",
  ),
  // Discover tab candidate filters (local only — never mirrored to the backend).
  discoverSignals: jsonSetting(
    "discoverSignals",
    z.array(z.enum(["forward", "mention", "link"])),
    ["forward", "mention", "link"] as DiscoverySignalKind[],
  ),
  // REACH-04 renamed the "medianViews" sort to "reach"; a saved one is read
  // as the new key so the preference survives rather than falling back.
  discoverSortKey: {
    ...enumSetting<DiscoverSortKey>(
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
        "lastPostAt",
        "postsPerWeek",
        "reach",
      ]),
      "total",
    ),
    decode: (raw: string) => (raw === "medianViews" ? "reach" : raw),
  },
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
