import type { Dispatch, SetStateAction } from "react"

import type { JobStatusEntry } from "@/api/jobs"
import type { SettingsSection } from "@/lib/settingsSection"
import type { Channel, Post, Summary, TabType } from "@/types"

export type CommandKind =
  | "action"
  | "boolean"
  | "enum"
  | "editor"
  | "entity-root"
  | "assistant"

export type PaletteMode =
  | "commands"
  | "editor"
  | "entity"
  | "confirm"
  | "assistant"
  | "search-results"

export type SearchResultsKind = "posts" | "summaries"

export interface SearchResultsState {
  kind: SearchResultsKind
  query: string
  items: Post[] | Summary[]
  totalCount?: number
}

export type EntityFlowType =
  | "search-channel"
  | "select-channel"
  | "deselect-channel"
  | "freeze-channel"
  | "unfreeze-channel"
  | "sync-channel"
  | "delete-channel"
  | "toggle-auto-follow"
  | "open-post"
  | "reset-sync-channel"
  | "fix-partial-history-channel"
  | "add-tag-channel"
  | "remove-tag-channel"
  | "remove-tag-pick"
  | "edit-start-id-channel"
  | "refresh-metadata-channel"
  | "delete-summary"
  | "pick-post"
  | "clear-db-table"

export interface CommandDisabledState {
  disabled: boolean
  reason?: string
}

export interface EditorFieldDef {
  id: string
  label: string
  type: "number" | "text" | "textarea" | "datetime-local" | "days"
  min?: number
  max?: number
  step?: number
  advancedOnly?: boolean
  getValue: (ctx: CommandContext) => string | number
  apply: (ctx: CommandContext, value: string) => void | Promise<void>
}

export interface CommandDef {
  id: string
  kind: CommandKind
  label: string
  keywords: string[]
  group: string
  requiresConfirmation?: boolean
  confirmDescription?: string
  getConfirmDescription?: (ctx: CommandContext, payload?: unknown) => string
  when?: (ctx: CommandContext) => boolean
  disabled?: (ctx: CommandContext) => CommandDisabledState
  getBadge?: (ctx: CommandContext) => "ON" | "OFF" | null
  editorField?: EditorFieldDef
  entityFlow?: EntityFlowType
  /** When false, entity sub-view stays open after a pick (default: true). */
  closeOnPick?: boolean
  /** When false, editor sub-view stays open after Apply (default: true). */
  closeOnApply?: boolean
  allowEmptyApply?: boolean
  searchResultsKind?: SearchResultsKind
  run: (ctx: CommandContext, payload?: unknown) => void | Promise<void>
}

export interface PaletteControls {
  close: () => void
  pushMode: (mode: PaletteMode) => void
  popMode: () => void
  openEditor: (command: CommandDef) => void
  openEntity: (command: CommandDef) => void
  openConfirm: (command: CommandDef, payload?: unknown) => void
  openSearchResults: (state: SearchResultsState, command: CommandDef) => void
  confirmPayload: unknown
  entityPayload: unknown
  setEntityPayload: (payload: unknown) => void
  searchResultsState: SearchResultsState | null
  searchResultsCommand: CommandDef | null
  getRootQuery: () => string
}

export interface JobToggleApi {
  jobStatus: Record<string, JobStatusEntry>
  refreshJobStatus: () => Promise<void>
  toggleJob: (jobId: string, enabled: boolean) => Promise<void>
  isJobEnabled: (jobId: string) => boolean
}

export interface CommandContext {
  setActiveTab: (tab: TabType) => void
  setActiveSection: (section: SettingsSection) => void
  channels: Channel[]
  selectedChannels: Set<string>
  setSelectedChannels: Dispatch<SetStateAction<Set<string>>>
  setChannels: Dispatch<SetStateAction<Channel[]>>
  handleScrapeAll: () => Promise<void>
  handleScrapeSelected: () => Promise<void>
  handleScrapeChannel: (
    channel: Channel,
    refresh?: boolean,
    source?: string,
    options?: { ignoreFrozen?: boolean },
  ) => Promise<void>
  addToSyncQueue: (
    channel: Channel,
    source: string,
    onComplete?: () => void,
  ) => void
  loadChannels: () => Promise<void>
  loadDBStats?: () => Promise<void>
  loadNetworkLogs: () => Promise<void>
  getEffectiveGlobalStartTime: () => number
  isOffline: boolean
  autoSyncPauseUntil: number | null
  setAutoSyncPauseUntil: (value: number | null) => void
  startTour: () => void
  jobToggles: JobToggleApi
  palette: PaletteControls
  settings: CommandSettingsSlice
  summariesHistory: Summary[]
  postDateRange?: { startDate: number; endDate: number }
  postSearch: string
  setPostSearch: (query: string) => void
  setSemanticSearchQuery: (query: string) => void
  setSemanticSearchRespectsTimeRange: (value: boolean) => void
  setSemanticSearchRespectsChannels: (value: boolean) => void
  setRelatedPostSearch: (post: Post | null) => void
  handleFilterPosts: (searchText?: string) => Promise<void>
  historySearchQuery: string
  setHistorySearchQuery: (query: string) => void
  setSummary: (text: string | null) => void
  setDateRange: (start: number, end: number) => void
  setChatMessages: (
    messages: { role: "user" | "model"; text: string }[],
  ) => void
  setCurrentSummaryId: (id: string | null) => void
  forwardedFilter: "all" | "forwarded" | "original" | "unfollowed_forwarded"
  setForwardedFilter: (
    value: "all" | "forwarded" | "original" | "unfollowed_forwarded",
  ) => void
  filteredPosts: import("@/types").Post[]
  starredOnly: boolean
  setStarredOnly: (value: boolean) => void
  handleSummarize: () => Promise<void>
  copySummaryPrompt: () => Promise<void>
  completePendingSummary: (
    summaryId: string,
    text: string,
    modelName?: string,
  ) => Promise<boolean>
  loadHistory: () => Promise<void>
  currentSummaryId: string | null
  indexedDbTables: string[]
}

export interface CommandSettingsSlice {
  theme: "light" | "dark"
  setTheme: (theme: "light" | "dark") => void
  aiLanguage: string
  setAiLanguage: (language: string) => void
  selectedModel: string
  setSelectedModel: (model: string) => void
  autoSyncEnabled: boolean
  setAutoSyncEnabled: (enabled: boolean) => void
  autoSyncInterval: number
  setAutoSyncInterval: (interval: number) => void
  aiTemperature: number
  setAiTemperature: (temp: number) => void
  proxyEnabled: boolean
  setProxyEnabled: (enabled: boolean) => void
  defaultProxyUrls: string
  setDefaultProxyUrls: (urls: string) => void
  proxyDefaultConcurrency: number
  setProxyDefaultConcurrency: (slots: number) => void
  proxyConcurrencyOverrides: Record<string, number>
  setProxyConcurrencyOverrides: (overrides: Record<string, number>) => void
  torEnabled: boolean
  setTorEnabled: (enabled: boolean) => void
  torMode: "auto" | "custom"
  setTorMode: (mode: "auto" | "custom") => void
  torProxyUrls: string
  setTorProxyUrls: (urls: string) => void
  torRotationStrategy: "sequential" | "random"
  setTorRotationStrategy: (strategy: "sequential" | "random") => void
  torControlEnabled: boolean
  setTorControlEnabled: (enabled: boolean) => void
  torControlPort: number
  setTorControlPort: (port: number) => void
  torAutoRotate: boolean
  setTorAutoRotate: (enabled: boolean) => void
  torRotationThreshold: number
  setTorRotationThreshold: (threshold: number) => void
  syncConcurrency: number
  setSyncConcurrency: (count: number) => void
  embeddingsEnabled: boolean
  setEmbeddingsEnabled: (enabled: boolean) => void
  embeddingsPaused: boolean
  setEmbeddingsPaused: (paused: boolean) => void
  translationEnabled: boolean
  setTranslationEnabled: (enabled: boolean) => void
  autoTranslate: boolean
  setAutoTranslate: (enabled: boolean) => void
  translationModel: string
  setTranslationModel: (model: string) => void
  translationTargetLanguage: string
  setTranslationTargetLanguage: (language: string) => void
  postRetentionDays: number
  setPostRetentionDays: (days: number) => void
  logRetentionDays: number
  setLogRetentionDays: (days: number) => void
  globalStartTimeMode: "retention" | "relative" | "absolute"
  setGlobalStartTimeMode: (mode: "retention" | "relative" | "absolute") => void
  globalStartTimeValue: number | string | null
  setGlobalStartTimeValue: (val: number | string | null) => void
  showChannelBio: boolean
  setShowChannelBio: (show: boolean) => void
  showChannelSubscribers: boolean
  setShowChannelSubscribers: (show: boolean) => void
  showChannelPhotos: boolean
  setShowChannelPhotos: (show: boolean) => void
  showChannelVideos: boolean
  setShowChannelVideos: (show: boolean) => void
  showChannelFiles: boolean
  setShowChannelFiles: (show: boolean) => void
  showChannelLinks: boolean
  setShowChannelLinks: (show: boolean) => void
  showChannelStartId: boolean
  setShowChannelStartId: (show: boolean) => void
  advancedMode: boolean
  setAdvancedMode: (advanced: boolean) => void
}

export interface RankedCommand {
  command: CommandDef
  score: number
}

export interface AffinityEntry {
  query: string
  commandId: string
  count: number
  lastUsedAt: number
}
