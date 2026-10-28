import type { Dispatch, SetStateAction } from "react"

import type { JobStatusEntry } from "@/api/jobs"
import type {
  Channel,
  ChannelStats,
  Post,
  SummaryListItem,
  TabType,
} from "@/types"

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
  items: Post[] | SummaryListItem[]
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
  | "copy-channel-telegram-chat-id"
  | "delete-summary"
  | "pick-post"
  | "clear-db-table"
  | "filter-by-setting-group"
  | "move-to-setting-group"
  | "open-setting-group"

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
  step?: number | "any"
  integer?: boolean
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
  getBadge?: (ctx: CommandContext) => string | null
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
  /** Opens Settings at a Setting id, a panel id or a topic id (SET-02). */
  openSetting: (id: string) => void
  channels: Channel[]
  channelStats: Record<string, ChannelStats>
  selectedChannels: Set<string>
  setSelectedChannels: Dispatch<SetStateAction<Set<string>>>
  /** The Channels tab's Shown Channels, or null while it is not mounted. */
  shownChannelNames: string[] | null
  setChannels: Dispatch<SetStateAction<Channel[]>>
  handleScrapeAll: () => Promise<void>
  handleScrapeSelected: (names?: Set<string>) => Promise<void>
  handleRecheckRestricted: () => Promise<void>
  handleScrapeChannel: (
    channel: Channel,
    refresh?: boolean,
    source?: string,
  ) => Promise<void>
  addToSyncQueue: (
    channel: Channel,
    source: string,
    onComplete?: () => void,
  ) => void
  loadChannels: () => Promise<void>
  loadDBStats?: () => Promise<void>
  getEffectiveGlobalStartTime: () => number
  isOffline: boolean
  autoSyncPauseUntil: number | null
  setAutoSyncPauseUntil: (value: number | null) => void
  startTour: () => void
  jobToggles: JobToggleApi
  palette: PaletteControls
  settings: CommandSettingsSlice
  summariesHistory: SummaryListItem[]
  postDateRange?: { startDate: number; endDate: number }
  /** What the Posts tab shows (ADR-039), and the edits a command makes to it. */
  postsView: import("@/lib/posts/posts-view").PostsView
  postsEdits: import("@/contexts/PostsViewContext").PostsViewEdits
  historySearchQuery: string
  setHistorySearchQuery: (query: string) => void
  setSummary: (text: string | null) => void
  setDateRange: (start: number, end: number) => void
  setChatMessages: (
    messages: { role: "user" | "model"; text: string }[],
  ) => void
  /** The tab strip's operations (TABS-01). */
  workspaceTabs: Pick<
    import("@/hooks/useWorkspaceTabs").WorkspaceTabs,
    "active" | "openTab" | "closeTab" | "reopenLastTab"
  >
  /** Per-channel in-scope post counts on demand (server-side when eligible). */
  getPostsInScopeCounts: () => Promise<Record<string, number>>
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
  /** Clearable server tables; see `lib/data-transfer/tables.ts`. */
  databaseTables: string[]
  settingGroups: import("@/types").ChannelSettingGroup[]
  invalidateSettingGroups: () => Promise<void>
  /** Sets the Channel filter to that one Setting group. */
  setChannelGroupFilter: (groupId: string) => void
  setSelectedSettingGroup: (groupId: string) => void
}

import type { SettingsContextType } from "@/contexts/SettingsContext"

/** The Settings command code reads; registry commands use `settings-schema.ts`. */
export type CommandSettingsSlice = Pick<
  SettingsContextType,
  | "theme"
  | "setTheme"
  | "channelActionLimit"
  | "setChannelActionLimit"
  | "embeddingsEnabled"
  | "globalStartTimeMode"
  | "proxyEnabled"
  | "defaultProxyUrls"
  | "torEnabled"
  | "torMode"
  | "torProxyUrls"
  | "torAutoRotate"
  | "torRotationThreshold"
  | "torControlPort"
>

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
