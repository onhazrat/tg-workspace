/**
 * PROTOTYPE (settings redesign), throwaway. Shared facts the variants draw from:
 * where each setting is stored, who may write it, and how the groups regroup.
 *
 * Scope is derived from where the value actually lives today, not invented:
 * - no backend section in `schema.ts` → this browser only (`scopedStorage`)
 * - `sync`/`retention` → split field by field, mirroring
 *   `backend/app/services/settings_registry.py` (SYNC_PREF_FIELDS,
 *   RETENTION_PREF_FIELDS are personal, the rest is deployment policy)
 * - `translation`/`reach`/network/jobs → deployment
 * - `publishing` → account
 */
import type { Theme } from "@/components/theme-provider"
import { useSettings } from "@/contexts/SettingsContext"
import { getCatalogEntry, SETTINGS_CATALOG } from "@/lib/settings/catalog"
import type { SettingCatalogEntry } from "@/lib/settings/catalog-types"
import { type AppSettingKey, appSettingsSpec } from "@/lib/settings/schema"

export type Scope = "browser" | "account" | "deployment"

export const SCOPE_LABEL: Record<Scope, string> = {
  browser: "This browser",
  account: "My account",
  deployment: "Deployment",
}

export const SCOPE_HINT: Record<Scope, string> = {
  browser: "Saved in this browser only. Other devices keep their own value.",
  account: "Saved to your account. Follows you to every device.",
  deployment: "One value for everyone on this deployment. Admins set it.",
}

const ACCOUNT_FIELDS = new Set([
  // sync_prefs
  "dynamicSyncEnabledDefault",
  "dynamicSyncExpectedPostsDefault",
  "globalStartTimeMode",
  "globalStartTimeValue",
  // retention_prefs
  "logRetentionDays",
  "reportRetentionDays",
  "reportRetentionMax",
])

export function scopeOf(entry: SettingCatalogEntry): Scope {
  if (entry.id === "embeddingsEnabled") return "deployment" // a scheduler job
  if (entry.source === "network" || entry.source === "jobs") return "deployment"
  if (entry.source === "theme") return "browser"
  if (entry.control.kind === "panel") return PANEL_SCOPE[entry.id] ?? "account"
  if (ACCOUNT_FIELDS.has(entry.id)) return "account"
  const spec = appSettingsSpec[entry.id as AppSettingKey]
  if (!spec?.section) return "browser"
  return spec.section === "publishing" ? "account" : "deployment"
}

const PANEL_SCOPE: Record<string, Scope> = {
  "panel-setting-groups": "account",
  "panel-proxy": "deployment",
  "panel-tor": "deployment",
  "panel-bot-credentials": "account",
  "panel-destinations": "account",
  "panel-publication-options": "account",
}

/** Catalog ids that read as "advanced": tuning most people never touch. */
export const ADVANCED_IDS = new Set([
  "showChannelTelegramChatId",
  "showChannelStartId",
  "dynamicSyncExpectedPostsDefault",
  "syncFailureBackoffMinutes",
  "settlingAgeHours",
  "estimationFloorHours",
  "reachSampleSize",
  "curveRefitIntervalHours",
  "aiTemperature",
  "embeddingsPaused",
  "reportRetentionMax",
  "sharedLogRetentionDays",
])

/** Settings drawn by a bespoke control or panel rather than a plain row. */
export const NOT_A_ROW = new Set(["globalStartTimeValue"])

export type ProtoGroupId =
  | "appearance"
  | "ai"
  | "sync"
  | "publishing"
  | "retention"
  | "network"

/** A redesigned group: plain rows from the catalog plus the panels it hosts. */
export interface ProtoGroup {
  id: ProtoGroupId
  label: string
  blurb: string
  rows: string[]
  panels: ProtoPanelId[]
}

export type ProtoPanelId =
  | "ai-keys"
  | "setting-groups"
  | "jobs"
  | "bots"
  | "destinations"
  | "publication-options"
  | "proxy"
  | "tor"

export const PANEL_INFO: Record<
  ProtoPanelId,
  { label: string; scope: Scope; blurb: string }
> = {
  "ai-keys": {
    label: "AI keys",
    scope: "account",
    blurb: "The keys your Summaries, Chats and Tags are paid with.",
  },
  "setting-groups": {
    label: "Setting groups",
    scope: "account",
    blurb: "Named bundles of sync settings you assign to channels.",
  },
  jobs: {
    label: "Background jobs",
    scope: "deployment",
    blurb: "Scheduled work the worker runs even when no browser is open.",
  },
  bots: {
    label: "Bots",
    scope: "account",
    blurb: "Telegram bots that publish your Summaries.",
  },
  destinations: {
    label: "Destinations",
    scope: "account",
    blurb: "Channels and chats your bots publish to.",
  },
  "publication-options": {
    label: "Publication options",
    scope: "account",
    blurb: "How a published Summary reads: citations, previews, time zone.",
  },
  proxy: {
    label: "Proxies",
    scope: "deployment",
    blurb: "Outbound proxies every sync goes through.",
  },
  tor: {
    label: "Tor",
    scope: "deployment",
    blurb: "Route syncs through Tor, with optional circuit rotation.",
  },
}

export const PROTO_GROUPS: ProtoGroup[] = [
  {
    id: "appearance",
    label: "Appearance",
    blurb: "Theme and what channel cards show.",
    rows: SETTINGS_CATALOG.filter((e) => e.group === "appearance").map(
      (e) => e.id,
    ),
    panels: [],
  },
  {
    id: "ai",
    label: "AI",
    blurb: "Models, language, embeddings and translation.",
    rows: [
      "selectedModel",
      "aiLanguage",
      "aiTemperature",
      "translationEnabled",
      "autoTranslate",
      "translationTargetLanguage",
      "translationModel",
      "embeddingsEnabled",
      "embeddingsPaused",
    ],
    panels: ["ai-keys"],
  },
  {
    id: "sync",
    label: "Channels & sync",
    blurb: "How often channels sync and where new follows start.",
    rows: [
      "globalStartTimeMode",
      "dynamicSyncEnabledDefault",
      "dynamicSyncExpectedPostsDefault",
      "regularSyncIntervalMinutes",
      "syncFailureBackoffMinutes",
      "settlingAgeHours",
      "estimationFloorHours",
      "reachSampleSize",
      "curveRefitIntervalHours",
    ],
    panels: ["setting-groups", "jobs"],
  },
  {
    id: "publishing",
    label: "Publishing",
    blurb: "Bots, destinations and how a Publication reads.",
    rows: [],
    panels: ["publication-options", "bots", "destinations"],
  },
  {
    id: "retention",
    label: "Retention",
    blurb: "How long posts, logs and reports are kept.",
    rows: [
      "logRetentionDays",
      "reportRetentionDays",
      "reportRetentionMax",
      "postRetentionDays",
      "sharedLogRetentionDays",
    ],
    panels: [],
  },
  {
    id: "network",
    label: "Network",
    blurb: "Proxies and Tor for outbound Telegram traffic.",
    rows: [],
    panels: ["proxy", "tor"],
  },
]

/** The sections that move out of Settings into an Admin "System" area. */
export const MOVED_OUT: { section: string; label: string; why: string }[] = [
  {
    section: "diagnostics",
    label: "Diagnostics",
    why: "a tool, not a setting",
  },
  {
    section: "network-telemetry",
    label: "Network telemetry",
    why: "a log view",
  },
  {
    section: "configuration",
    label: "Configuration catalog",
    why: "read-only env values",
  },
  { section: "table-sizes", label: "Table sizes", why: "a report" },
  { section: "query", label: "Query console", why: "a tool" },
  { section: "transfer", label: "Import / export", why: "an action" },
  {
    section: "quick-message",
    label: "Quick message",
    why: "belongs next to Publish",
  },
]

export const entryFor = (id: string) => getCatalogEntry(id)

/** "Show Channel Telegram Chat ID" → "Show channel Telegram chat ID". */
const KEEP = new Set(["AI", "ID", "Tor", "Telegram", "Discover", "URLs"])
export function sentenceCase(label: string): string {
  return label
    .split(" ")
    .map((word, i) => (i === 0 || KEEP.has(word) ? word : word.toLowerCase()))
    .join(" ")
}

/** Value + setter for a catalog entry, through the real settings context. */
export function useCatalogValue(
  entry: SettingCatalogEntry,
): [unknown, (v: unknown) => void] {
  const settings = useSettings() as unknown as Record<string, unknown> & {
    theme: Theme
    setTheme: (t: Theme) => void
  }
  if (entry.id === "theme") {
    return [settings.theme, (v) => settings.setTheme(v as Theme)]
  }
  const key = (entry.sliceKey ?? entry.id) as string
  const setter = settings[`set${key.charAt(0).toUpperCase()}${key.slice(1)}`]
  return [
    settings[key],
    (v) => {
      if (typeof setter === "function") (setter as (x: unknown) => void)(v)
    },
  ]
}

export function settingUrl(id: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set("tab", "settings")
  url.searchParams.set("setting", id)
  return url.toString()
}

export function matches(entry: SettingCatalogEntry, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [entry.id, entry.label, entry.description, ...entry.keywords]
    .join(" ")
    .toLowerCase()
    .includes(needle)
}
