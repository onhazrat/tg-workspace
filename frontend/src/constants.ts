import { env } from "./lib/env"

export const DEFAULT_AI_LANGUAGE = env.defaultAiLanguage
export const DEFAULT_MODEL = env.defaultAiModel
export const AUTO_SYNC_INTERVAL_DEFAULT = env.autoSyncIntervalDefault
export const THEME_DEFAULT = "dark"

export const WORKSPACE_TABS = [
  { id: "channels", label: "Channels", icon: "Send" },
  { id: "posts", label: "Posts", icon: "List" },
  { id: "summary", label: "Summary", icon: "FileText" },
  { id: "chat", label: "Chat", icon: "MessageSquare" },
  { id: "history", label: "History", icon: "History" },
  { id: "settings", label: "Settings", icon: "Settings" },
] as const

export const SETTINGS_TABS = [
  { id: "appearance", label: "Appearance", icon: "Layout" },
  { id: "sync", label: "Scraping & Sync", icon: "RefreshCw" },
  { id: "ai", label: "AI & Models", icon: "Cpu" },
  { id: "network", label: "Network & Security", icon: "Globe" },
  { id: "db", label: "Data Management", icon: "Database" },
  { id: "publishing", label: "Publishing", icon: "Send" },
  { id: "diagnostics", label: "Diagnostics", icon: "Activity" },
  { id: "runtime-config", label: "Runtime Config", icon: "Braces" },
] as const

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
