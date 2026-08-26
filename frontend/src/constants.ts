import { env } from "./lib/env"

export const DEFAULT_AI_LANGUAGE = env.defaultAiLanguage
export const DEFAULT_MODEL = env.defaultAiModel
export const AUTO_SYNC_INTERVAL_DEFAULT = env.autoSyncIntervalDefault
export const DYNAMIC_SYNC_EXPECTED_POSTS_DEFAULT =
  env.dynamicSyncExpectedPostsDefault
export const AUTO_SYNC_INTERVAL_MIN_MINUTES = 5
/** Max auto-sync staleness interval (24 hours). */
export const AUTO_SYNC_INTERVAL_MAX_MINUTES = 24 * 60
export const RETENTION_POST_DAYS_DEFAULT = env.retentionPostDaysDefault
export const RETENTION_LOG_DAYS_DEFAULT = env.retentionLogDaysDefault
export const RETENTION_SHARED_LOG_DAYS_DEFAULT =
  env.retentionSharedLogDaysDefault
export const RETENTION_PAYLOAD_DAYS_DEFAULT = env.retentionPayloadDaysDefault
export const RETENTION_REPORT_DAYS_DEFAULT = env.retentionReportDaysDefault
export const RETENTION_REPORT_MAX_DEFAULT = env.retentionReportMaxDefault
export const THEME_DEFAULT = "dark"

export const WORKSPACE_TABS = [
  { id: "channels", label: "Channels", icon: "Send" },
  { id: "posts", label: "Posts", icon: "List" },
  { id: "action", label: "Action", icon: "Zap" },
  { id: "summary", label: "Summary", icon: "FileText" },
  { id: "tag", label: "Tag", icon: "Tag" },
  { id: "discover", label: "Discover", icon: "Compass" },
  { id: "chat", label: "Chat", icon: "MessageSquare" },
  { id: "history", label: "History", icon: "History" },
  { id: "settings", label: "Settings", icon: "Settings" },
] as const

/**
 * The workspace tabs, as a type.
 *
 * Derived rather than declared, because it used to be neither: `TabType` was a
 * hand-written union in `types.ts` and `VALID_TABS` was copied into both
 * `routes/_tg/summarizer.tsx` and `hooks/useSummarizerTab.ts`. Three lists to
 * keep in step meant adding a tab to two of them left it reachable by URL but
 * silently falling back to `summary`, and the hand-written union had drifted to
 * carry three ids (`db`, `bots`, `logs`) that no tab had rendered for months.
 *
 * `WORKSPACE_TABS` is now the only place a tab is declared.
 */
export type TabType = (typeof WORKSPACE_TABS)[number]["id"]

/**
 * Every tab id, for validating `?tab=`.
 *
 * Deliberately the *unfiltered* list. `compactWorkspaceTabs` hides tabs from the
 * nav, but a hidden tab must stay reachable by URL — otherwise every deep link,
 * palette command and `setActiveTab` call breaks the moment the setting is
 * flipped.
 */
export const VALID_TABS: readonly TabType[] = WORKSPACE_TABS.map(
  (tab) => tab.id,
)

/**
 * The tabs `compactWorkspaceTabs` leaves in the nav.
 *
 * Channels and Posts are how you set the scope, Action is how you make
 * something from it, History is what you made, Settings is everything else.
 * The four feature tabs render results and are reached by opening an artifact,
 * so they do not need to be in the nav — but they stay in `VALID_TABS`, because
 * hiding a tab must not make it unreachable.
 */
export const COMPACT_WORKSPACE_TAB_IDS: readonly TabType[] = [
  "channels",
  "posts",
  "action",
  "history",
  "settings",
]

export const SETTINGS_TABS = [
  { id: "commonly-used", label: "Commonly Used", icon: "Star" },
  { id: "appearance", label: "Appearance", icon: "Layout" },
  { id: "channels-sync", label: "Channels & Sync", icon: "RefreshCw" },
  { id: "ai", label: "AI & Models", icon: "Cpu" },
  { id: "network", label: "Network", icon: "Globe" },
  { id: "publishing", label: "Publishing", icon: "Send" },
  { id: "data", label: "Data", icon: "Database" },
  { id: "diagnostics", label: "Diagnostics", icon: "Activity" },
  { id: "runtime-config", label: "Runtime Config", icon: "Braces" },
] as const

/** Flat list of top-level settings destinations (legacy navigate / labels). Prefer SETTINGS_TOC. */

export const MODELS = [
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite" },
]

/** Stored in Summary.model for externally pasted AI responses (not in-app generation). */
export const PASTED_SUMMARY_MODEL = "external"

export function isPastedSummaryModel(model?: string | null): boolean {
  return model === PASTED_SUMMARY_MODEL
}

export function formatSummaryModelLabel(model?: string | null): string {
  if (!model) return "Unknown"
  if (isPastedSummaryModel(model)) return "External"
  return MODELS.find((m) => m.id === model)?.label ?? model
}

export function resolvePastedSummaryModel(optionalName?: string): string {
  const trimmed = optionalName?.trim()
  return trimmed ? trimmed : PASTED_SUMMARY_MODEL
}

export function isPendingSummary(summary: {
  status?: string
  text?: string
}): boolean {
  return summary.status === "pending"
}

export const LANGUAGES = [
  "English",
  "Persian",
  "Spanish",
  "French",
  "German",
  "Chinese",
  "Japanese",
  "Russian",
  "Portuguese",
  "Italian",
  "Arabic",
]
