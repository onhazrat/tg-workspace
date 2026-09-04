import {
  AUTO_SYNC_INTERVAL_DEFAULT,
  AUTO_SYNC_INTERVAL_MAX_MINUTES,
  AUTO_SYNC_INTERVAL_MIN_MINUTES,
  DYNAMIC_SYNC_EXPECTED_POSTS_DEFAULT,
  LANGUAGES,
  MODELS,
  RETENTION_LOG_DAYS_DEFAULT,
  RETENTION_POST_DAYS_DEFAULT,
  RETENTION_REPORT_DAYS_DEFAULT,
  RETENTION_REPORT_MAX_DEFAULT,
  RETENTION_SHARED_LOG_DAYS_DEFAULT,
} from "@/constants"
import { NETWORK_SETTINGS_DEFAULTS } from "@/lib/settings/network"
import { appSettingsSpec } from "@/lib/settings/schema"
import type { SettingCatalogEntry } from "./catalog-types"

function formatRetentionBadge(days: number): string {
  return days === 0 ? "Never" : `${days}d`
}

/** Curated static Commonly Used ids (v1 — no affinity). */
export const COMMONLY_USED_SETTING_IDS = [
  "theme",
  "selectedModel",
  "aiLanguage",
  "proxyEnabled",
  "postRetentionDays",
  "regularSyncIntervalMinutes",
  "embeddingsEnabled",
] as const

/**
 * Canonical settings catalog — feeds hub UI, flatten search, and palette commands.
 * Persistence stays in app/network/theme/jobs stores; catalog only references `source`.
 */
export const SETTINGS_CATALOG: SettingCatalogEntry[] = [
  // --- Appearance ---
  {
    id: "theme",
    label: "Color Theme",
    description: "Light, dark, or follow system preference.",
    keywords: ["theme", "appearance", "light", "dark", "system"],
    group: "appearance",
    source: "theme",
    defaultValue: "dark",
    control: {
      kind: "enum",
      commandPrefix: "theme",
      options: [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "System" },
      ],
    },
  },
  {
    id: "showChannelBio",
    label: "Show Channel Bio",
    description: "Show channel bio text on channel cards.",
    keywords: ["appearance", "channel", "bio"],
    group: "appearance",
    source: "app",
    defaultValue: appSettingsSpec.showChannelBio.defaultValue,
    control: { kind: "boolean", commandSlug: "show-channel-bio" },
  },
  {
    id: "showChannelSubscribers",
    label: "Show Channel Subscribers",
    description: "Show subscriber count on channel cards.",
    keywords: ["appearance", "channel", "subscribers"],
    group: "appearance",
    source: "app",
    defaultValue: appSettingsSpec.showChannelSubscribers.defaultValue,
    control: { kind: "boolean", commandSlug: "show-channel-subscribers" },
  },
  {
    id: "showChannelTelegramChatId",
    label: "Show Channel Telegram Chat ID",
    description: "Show Telegram chat ID on channel cards.",
    keywords: ["appearance", "channel", "telegram", "chat", "id"],
    group: "appearance",
    source: "app",
    defaultValue: appSettingsSpec.showChannelTelegramChatId.defaultValue,
    control: {
      kind: "boolean",
      commandSlug: "show-channel-telegram-chat-id",
    },
  },
  {
    id: "showChannelPhotos",
    label: "Show Channel Photos",
    description: "Show photo count on channel cards.",
    keywords: ["appearance", "channel", "photos"],
    group: "appearance",
    source: "app",
    defaultValue: appSettingsSpec.showChannelPhotos.defaultValue,
    control: { kind: "boolean", commandSlug: "show-channel-photos" },
  },
  {
    id: "showChannelVideos",
    label: "Show Channel Videos",
    description: "Show video count on channel cards.",
    keywords: ["appearance", "channel", "videos"],
    group: "appearance",
    source: "app",
    defaultValue: appSettingsSpec.showChannelVideos.defaultValue,
    control: { kind: "boolean", commandSlug: "show-channel-videos" },
  },
  {
    id: "showChannelFiles",
    label: "Show Channel Files",
    description: "Show file count on channel cards.",
    keywords: ["appearance", "channel", "files"],
    group: "appearance",
    source: "app",
    defaultValue: appSettingsSpec.showChannelFiles.defaultValue,
    control: { kind: "boolean", commandSlug: "show-channel-files" },
  },
  {
    id: "showChannelLinks",
    label: "Show Channel Links",
    description: "Show link count on channel cards.",
    keywords: ["appearance", "channel", "links"],
    group: "appearance",
    source: "app",
    defaultValue: appSettingsSpec.showChannelLinks.defaultValue,
    control: { kind: "boolean", commandSlug: "show-channel-links" },
  },
  {
    id: "showChannelStartId",
    label: "Show Channel Start ID",
    description: "Show start message ID on channel cards.",
    keywords: ["appearance", "channel", "start", "id"],
    group: "appearance",
    source: "app",
    defaultValue: appSettingsSpec.showChannelStartId.defaultValue,
    control: { kind: "boolean", commandSlug: "show-channel-start-id" },
  },
  {
    id: "compactWorkspaceTabs",
    label: "Compact Workspace Tabs",
    description:
      "Show only Channels, Posts, Action, History and Settings. Hidden tabs stay reachable by URL and from the command palette.",
    keywords: ["appearance", "tabs", "workspace", "compact", "hide"],
    group: "appearance",
    source: "app",
    defaultValue: appSettingsSpec.compactWorkspaceTabs.defaultValue,
    control: { kind: "boolean", commandSlug: "compact-workspace-tabs" },
  },

  // --- Channels & Sync ---
  {
    id: "regularSyncIntervalMinutes",
    label: "Regular Sync Interval",
    description:
      "How often regular auto-sync checks channel staleness (minutes).",
    keywords: ["sync", "interval", "auto", "schedule", "minutes"],
    group: "channels-sync",
    source: "app",
    defaultValue: AUTO_SYNC_INTERVAL_DEFAULT,
    editorCommandId: "edit-regular-sync-interval-minutes",
    editorFieldId: "regularSyncIntervalMinutes",
    editorFieldLabel: "Regular Sync Interval (minutes)",
    control: {
      kind: "number",
      min: AUTO_SYNC_INTERVAL_MIN_MINUTES,
      max: AUTO_SYNC_INTERVAL_MAX_MINUTES,
      integer: true,
      formatBadge: (v) => `${v}m`,
    },
  },
  {
    id: "dynamicSyncEnabledDefault",
    label: "Dynamic Sync Default",
    description: "Default for dynamic sync on new channels / groups.",
    keywords: ["sync", "dynamic", "default"],
    group: "channels-sync",
    source: "app",
    defaultValue: appSettingsSpec.dynamicSyncEnabledDefault.defaultValue,
    control: { kind: "boolean", commandSlug: "dynamic-sync-default" },
  },
  {
    id: "dynamicSyncExpectedPostsDefault",
    label: "Dynamic Sync Expected Posts",
    description: "Expected posts per interval for dynamic sync pacing.",
    keywords: ["sync", "dynamic", "expected", "posts"],
    group: "channels-sync",
    source: "app",
    defaultValue: DYNAMIC_SYNC_EXPECTED_POSTS_DEFAULT,
    editorCommandId: "edit-dynamic-sync-expected-posts",
    editorFieldId: "dynamicSyncExpectedPostsDefault",
    editorFieldLabel: "Dynamic Sync Expected Posts",
    control: {
      kind: "number",
      min: 1,
      integer: true,
      formatBadge: (v) => String(v),
    },
  },
  {
    id: "syncFailureBackoffMinutes",
    label: "Sync Failure Backoff",
    description: "Minutes to wait after a failed sync before retrying.",
    keywords: ["sync", "failure", "backoff", "retry"],
    group: "channels-sync",
    source: "app",
    defaultValue: appSettingsSpec.syncFailureBackoffMinutes.defaultValue,
    editorCommandId: "edit-sync-failure-backoff-minutes",
    editorFieldId: "syncFailureBackoffMinutes",
    editorFieldLabel: "Sync Failure Backoff (minutes)",
    control: {
      kind: "number",
      min: 1,
      integer: true,
      formatBadge: (v) => `${v}m`,
    },
  },
  {
    id: "globalStartTimeMode",
    label: "Default Channel Start Time Mode",
    description: "How new channels pick their scrape start time.",
    keywords: [
      "global start time",
      "sync",
      "retention",
      "relative",
      "absolute",
    ],
    group: "channels-sync",
    source: "app",
    defaultValue: appSettingsSpec.globalStartTimeMode.defaultValue,
    control: {
      kind: "enum",
      commandPrefix: "global-start-time-mode",
      options: [
        { value: "retention", label: "retention" },
        { value: "relative", label: "relative" },
        { value: "absolute", label: "absolute" },
      ],
    },
  },
  {
    id: "globalStartTimeValue",
    label: "Default Channel Start Time Value",
    description: "Days ago or absolute datetime for the start-time mode.",
    keywords: ["global start time", "sync", "retention", "days", "date"],
    group: "channels-sync",
    source: "app",
    defaultValue: appSettingsSpec.globalStartTimeValue.defaultValue,
    control: {
      kind: "days",
      commandId: "edit-global-start-time-value",
      fieldId: "globalStartTimeValue",
    },
  },
  {
    id: "panel-setting-groups",
    label: "Setting Groups",
    description: "Manage channel setting groups and sync permissions.",
    keywords: ["setting groups", "groups", "sync", "permissions", "channels"],
    group: "channels-sync",
    source: "app",
    defaultValue: null,
    control: { kind: "panel", sectionId: "setting-groups" },
  },

  // --- AI ---
  {
    id: "aiLanguage",
    label: "AI Language",
    description: "Language for summaries and chat responses.",
    keywords: ["ai", "language"],
    group: "ai",
    source: "app",
    defaultValue: appSettingsSpec.aiLanguage.defaultValue,
    control: {
      kind: "enum",
      commandPrefix: "ai-language",
      options: LANGUAGES.map((l) => ({ value: l, label: l })),
    },
  },
  {
    id: "selectedModel",
    label: "AI Model",
    description: "Default Gemini model for summaries and chat.",
    keywords: ["ai", "model"],
    group: "ai",
    source: "app",
    defaultValue: appSettingsSpec.selectedModel.defaultValue,
    control: {
      kind: "enum",
      commandPrefix: "selected-model",
      options: MODELS.map((m) => ({ value: m.id, label: m.label })),
    },
  },
  {
    id: "aiTemperature",
    label: "AI Temperature",
    description: "Creativity vs precision for model outputs.",
    keywords: ["ai", "temperature", "model"],
    group: "ai",
    source: "app",
    defaultValue: appSettingsSpec.aiTemperature.defaultValue,
    editorCommandId: "edit-ai-temperature",
    editorFieldId: "aiTemperature",
    editorFieldLabel: "AI Temperature",
    control: {
      kind: "number",
      min: 0,
      max: 1,
      step: "any",
      formatBadge: (v) => v.toFixed(1),
    },
  },
  {
    id: "embeddingsEnabled",
    label: "Embeddings Feature",
    description: "Enable vector embeddings for semantic search and RAG.",
    keywords: ["embeddings", "feature", "rag", "ai"],
    group: "ai",
    source: "app",
    defaultValue: appSettingsSpec.embeddingsEnabled.defaultValue,
    // Special command ids: enable/disable-embeddings-feature (not boolean-triple)
    control: { kind: "boolean", commandSlug: "__embeddings_feature__" },
  },
  {
    id: "embeddingsPaused",
    label: "Pause Embeddings",
    description: "Temporarily pause background embedding generation.",
    keywords: ["embeddings", "pause", "ai"],
    group: "ai",
    source: "app",
    defaultValue: appSettingsSpec.embeddingsPaused.defaultValue,
    control: { kind: "boolean", commandSlug: "pause-embeddings" },
  },
  {
    id: "translationEnabled",
    label: "Translation",
    description: "Allow translating posts with Gemini.",
    keywords: ["translation", "language"],
    group: "ai",
    source: "app",
    defaultValue: appSettingsSpec.translationEnabled.defaultValue,
    control: { kind: "boolean", commandSlug: "translation" },
  },
  {
    id: "autoTranslate",
    label: "Auto Translate",
    description: "Automatically translate posts when loaded.",
    keywords: ["translation", "auto"],
    group: "ai",
    source: "app",
    defaultValue: appSettingsSpec.autoTranslate.defaultValue,
    control: { kind: "boolean", commandSlug: "auto-translate" },
  },
  {
    id: "translationTargetLanguage",
    label: "Translation Target Language",
    description: "Target language for post translation.",
    keywords: ["translation", "language"],
    group: "ai",
    source: "app",
    defaultValue: appSettingsSpec.translationTargetLanguage.defaultValue,
    control: {
      kind: "enum",
      commandPrefix: "translation-target-language",
      options: LANGUAGES.map((l) => ({ value: l, label: l })),
    },
  },
  {
    id: "translationModel",
    label: "Translation Model",
    description: "Model used for post translation.",
    keywords: ["translation", "model"],
    group: "ai",
    source: "app",
    defaultValue: appSettingsSpec.translationModel.defaultValue,
    control: {
      kind: "enum",
      commandPrefix: "translation-model",
      options: MODELS.map((m) => ({ value: m.id, label: m.label })),
    },
  },

  // --- Network ---
  {
    id: "proxyEnabled",
    label: "Proxy",
    description: "Route scraping traffic through configured proxies.",
    keywords: ["network", "proxy"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.proxyEnabled,
    control: { kind: "boolean", commandSlug: "proxy" },
  },
  {
    id: "defaultProxyUrls",
    label: "Default Proxy URLs",
    description: "One proxy URL per line.",
    keywords: ["proxy", "urls", "network"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.defaultProxyUrls,
    control: {
      kind: "textarea",
      commandId: "edit-default-proxy-urls",
      fieldId: "defaultProxyUrls",
    },
  },
  {
    id: "proxyDefaultConcurrency",
    label: "Proxy Default Concurrency",
    description: "Default concurrent slots per proxy.",
    keywords: ["proxy", "concurrency", "network"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.proxyDefaultConcurrency,
    editorCommandId: "edit-proxy-default-concurrency",
    editorFieldId: "proxyDefaultConcurrency",
    editorFieldLabel: "Proxy Default Concurrency",
    control: {
      kind: "number",
      min: 1,
      max: 20,
      integer: true,
      formatBadge: (v) => String(v),
    },
  },
  {
    id: "proxyConcurrencyOverrides",
    label: "Proxy Concurrency Overrides",
    description: "Per-proxy concurrency overrides as JSON.",
    keywords: ["proxy", "concurrency", "override", "network"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.proxyConcurrencyOverrides,
    control: {
      kind: "textarea",
      commandId: "edit-proxy-concurrency-overrides",
      fieldId: "proxyConcurrencyOverrides",
    },
  },
  {
    id: "torEnabled",
    label: "Tor",
    description: "Route traffic through Tor.",
    keywords: ["network", "tor"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.torEnabled,
    control: { kind: "boolean", commandSlug: "tor" },
  },
  {
    id: "torMode",
    label: "Tor Mode",
    description: "Auto-detect or custom Tor proxy URLs.",
    keywords: ["tor", "mode", "network"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.torMode,
    control: {
      kind: "enum",
      commandPrefix: "tor-mode",
      options: [
        { value: "auto", label: "auto" },
        { value: "custom", label: "custom" },
      ],
    },
  },
  {
    id: "torProxyUrls",
    label: "Tor Proxy URLs",
    description: "Custom Tor SOCKS proxy URLs.",
    keywords: ["tor", "proxy", "urls", "network"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.torProxyUrls,
    control: {
      kind: "textarea",
      commandId: "edit-tor-proxy-urls",
      fieldId: "torProxyUrls",
    },
  },
  {
    id: "torRotationStrategy",
    label: "Tor Rotation Strategy",
    description: "How Tor circuits rotate across requests.",
    keywords: ["tor", "rotation", "network"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.torRotationStrategy,
    control: {
      kind: "enum",
      commandPrefix: "tor-rotation-strategy",
      options: [
        { value: "sequential", label: "sequential" },
        { value: "random", label: "random" },
      ],
    },
  },
  {
    id: "torControlEnabled",
    label: "Tor Control",
    description: "Enable Tor control port for circuit rotation.",
    keywords: ["network", "tor", "control"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.torControlEnabled,
    control: { kind: "boolean", commandSlug: "tor-control" },
  },
  {
    id: "torControlPort",
    label: "Tor Control Port",
    description: "Tor control port number.",
    keywords: ["tor", "control", "port", "network"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.torControlPort,
    editorCommandId: "edit-tor-control-port",
    editorFieldId: "torControlPort",
    editorFieldLabel: "Tor Control Port",
    control: {
      kind: "number",
      min: 1,
      integer: true,
      formatBadge: (v) => String(v),
    },
  },
  {
    id: "torAutoRotate",
    label: "Tor Auto Rotate",
    description: "Automatically rotate Tor circuits on failures.",
    keywords: ["network", "tor", "rotate"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.torAutoRotate,
    control: { kind: "boolean", commandSlug: "tor-auto-rotate" },
  },
  {
    id: "torRotationThreshold",
    label: "Tor Rotation Threshold",
    description: "Failure count before rotating Tor circuit.",
    keywords: ["tor", "rotation", "threshold", "network"],
    group: "network",
    source: "network",
    defaultValue: NETWORK_SETTINGS_DEFAULTS.torRotationThreshold,
    editorCommandId: "edit-tor-rotation-threshold",
    editorFieldId: "torRotationThreshold",
    editorFieldLabel: "Tor Rotation Threshold",
    control: {
      kind: "number",
      min: 5,
      max: 50,
      integer: true,
      formatBadge: (v) => String(v),
    },
  },
  {
    id: "panel-proxy",
    label: "Proxy Settings",
    description: "Configure HTTP/SOCKS proxies for scraping.",
    keywords: ["proxy", "network", "panel"],
    group: "network",
    source: "network",
    defaultValue: null,
    control: { kind: "panel", sectionId: "proxy" },
  },
  {
    id: "panel-tor",
    label: "Tor Settings",
    description: "Configure Tor routing and circuit rotation.",
    keywords: ["tor", "network", "panel"],
    group: "network",
    source: "network",
    defaultValue: null,
    control: { kind: "panel", sectionId: "tor" },
  },

  // --- Data / retention ---
  {
    id: "postRetentionDays",
    label: "Post Retention Days",
    description: "Delete posts older than this many days (0 = never).",
    keywords: ["retention", "posts", "days"],
    group: "data",
    source: "app",
    defaultValue: RETENTION_POST_DAYS_DEFAULT,
    editorCommandId: "edit-post-retention-days",
    editorFieldId: "postRetentionDays",
    editorFieldLabel: "Post Retention (days)",
    control: {
      kind: "number",
      min: 0,
      integer: true,
      formatBadge: formatRetentionBadge,
    },
  },
  {
    id: "logRetentionDays",
    label: "Log Retention Days",
    description:
      "Delete your publish, AI and embedding logs older than this many days " +
      "(0 = never).",
    keywords: ["retention", "logs", "days"],
    group: "data",
    source: "app",
    defaultValue: RETENTION_LOG_DAYS_DEFAULT,
    editorCommandId: "edit-log-retention-days",
    editorFieldId: "logRetentionDays",
    editorFieldLabel: "Log Retention (days)",
    control: {
      kind: "number",
      min: 0,
      integer: true,
      formatBadge: formatRetentionBadge,
    },
  },
  {
    id: "sharedLogRetentionDays",
    label: "Shared Log Retention Days",
    description:
      "Delete sync and network logs, and logs no account owns, older than " +
      "this many days (0 = never). Admin only.",
    keywords: ["retention", "logs", "sync", "network", "shared", "days"],
    group: "data",
    source: "app",
    defaultValue: RETENTION_SHARED_LOG_DAYS_DEFAULT,
    editorCommandId: "edit-shared-log-retention-days",
    editorFieldId: "sharedLogRetentionDays",
    editorFieldLabel: "Shared Log Retention (days)",
    control: {
      kind: "number",
      min: 0,
      integer: true,
      formatBadge: formatRetentionBadge,
    },
  },
  {
    id: "reportRetentionDays",
    label: "Discover Report Retention Days",
    description:
      "Delete saved Discover reports older than this many days (0 = never).",
    keywords: ["retention", "discover", "reports", "days"],
    group: "data",
    source: "app",
    defaultValue: RETENTION_REPORT_DAYS_DEFAULT,
    editorCommandId: "edit-report-retention-days",
    editorFieldId: "reportRetentionDays",
    editorFieldLabel: "Discover Report Retention (days)",
    control: {
      kind: "number",
      min: 0,
      integer: true,
      formatBadge: formatRetentionBadge,
    },
  },
  {
    id: "reportRetentionMax",
    label: "Discover Report Limit",
    description:
      "Keep only this many of the newest Discover reports (0 = no limit).",
    keywords: ["retention", "discover", "reports", "limit", "count"],
    group: "data",
    source: "app",
    defaultValue: RETENTION_REPORT_MAX_DEFAULT,
    editorCommandId: "edit-report-retention-max",
    editorFieldId: "reportRetentionMax",
    editorFieldLabel: "Discover Report Limit (count)",
    control: {
      kind: "number",
      min: 0,
      integer: true,
    },
  },
  {
    id: "panel-retention",
    label: "Retention",
    description: "Post, log and Discover report retention policies.",
    keywords: ["retention", "data", "cleanup"],
    group: "data",
    source: "app",
    defaultValue: null,
    control: { kind: "panel", sectionId: "retention" },
  },
  {
    id: "panel-table-sizes",
    label: "Table Sizes",
    description: "Inspect Postgres table sizes.",
    keywords: ["table", "sizes", "database", "data"],
    group: "data",
    source: "app",
    defaultValue: null,
    control: { kind: "panel", sectionId: "table-sizes" },
  },
  {
    id: "panel-transfer",
    label: "Data Transfer",
    description: "Export, import, and migrate data.",
    keywords: ["export", "import", "migrate", "transfer", "data"],
    group: "data",
    source: "app",
    defaultValue: null,
    control: { kind: "panel", sectionId: "transfer" },
  },
  {
    id: "panel-query",
    label: "Query",
    description: "Run ad-hoc data queries.",
    keywords: ["query", "sql", "data"],
    group: "data",
    source: "app",
    defaultValue: null,
    control: { kind: "panel", sectionId: "query" },
  },
  // --- Publishing panels ---
  {
    id: "panel-bot-credentials",
    label: "Bot Credentials",
    description: "Telegram bot token and identity.",
    keywords: ["bot", "token", "credentials", "publishing"],
    group: "publishing",
    source: "app",
    defaultValue: null,
    control: { kind: "panel", sectionId: "bot-credentials" },
  },
  {
    id: "panel-destinations",
    label: "Destinations",
    description: "Publish destinations and chat targets.",
    keywords: ["destinations", "publish", "chat", "publishing"],
    group: "publishing",
    source: "app",
    defaultValue: null,
    control: { kind: "panel", sectionId: "destinations" },
  },
  {
    id: "panel-quick-message",
    label: "Quick Message",
    description: "Send a quick test message via the bot.",
    keywords: ["quick", "message", "send", "publishing"],
    group: "publishing",
    source: "app",
    defaultValue: null,
    control: { kind: "panel", sectionId: "quick-message" },
  },

  // --- Tools panels ---
  {
    id: "panel-diagnostics",
    label: "Diagnostics",
    description:
      "System logs, LLM logs, sync logs, embedding logs, publish logs, and network request logs.",
    keywords: [
      "diagnostics",
      "logs",
      "system logs",
      "llm logs",
      "sync logs",
      "embedding logs",
      "publish logs",
      "tools",
    ],
    group: "tools",
    source: "app",
    defaultValue: null,
    control: { kind: "panel", sectionId: "diagnostics" },
  },
  {
    id: "panel-network-telemetry",
    label: "Network Telemetry",
    description:
      "Live network connection telemetry, Tor status, and request health.",
    keywords: [
      "network telemetry",
      "telemetry",
      "network",
      "connections",
      "tor status",
      "tools",
    ],
    group: "tools",
    source: "app",
    defaultValue: null,
    control: { kind: "panel", sectionId: "network-telemetry" },
  },
  {
    id: "panel-runtime-config",
    label: "Runtime Config",
    description: "Read-only runtime configuration dump.",
    keywords: ["runtime", "config", "json", "tools"],
    group: "tools",
    source: "app",
    defaultValue: null,
    control: { kind: "panel", sectionId: "runtime-config" },
  },
]

const BY_ID = new Map(SETTINGS_CATALOG.map((e) => [e.id, e]))

/** DOM id used by SettingsHub deep-links (`?setting=<id>` → `#setting-<id>`). */
export function settingElementId(catalogId: string): string {
  return `setting-${catalogId}`
}

export function getCatalogEntry(id: string): SettingCatalogEntry | undefined {
  return BY_ID.get(id)
}

export function catalogEntriesForGroup(
  group: SettingCatalogEntry["group"],
): SettingCatalogEntry[] {
  return SETTINGS_CATALOG.filter((e) => e.group === group)
}

export function commonlyUsedEntries(): SettingCatalogEntry[] {
  return COMMONLY_USED_SETTING_IDS.map((id) => BY_ID.get(id)).filter(
    (e): e is SettingCatalogEntry => e != null,
  )
}

/** Knob rows (exclude panel targets). */
export function catalogKnobEntries(): SettingCatalogEntry[] {
  return SETTINGS_CATALOG.filter((e) => e.control.kind !== "panel")
}

export function catalogPanelEntries(): SettingCatalogEntry[] {
  return SETTINGS_CATALOG.filter((e) => e.control.kind === "panel")
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a === "object" && typeof b === "object" && a && b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return false
}

export function isSettingModified(
  entry: SettingCatalogEntry,
  currentValue: unknown,
): boolean {
  if (entry.control.kind === "panel") return false
  return !valuesEqual(currentValue, entry.defaultValue)
}
