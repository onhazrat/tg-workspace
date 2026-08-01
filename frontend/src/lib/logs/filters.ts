import type {
  EmbeddingLog,
  LLMLog,
  NetworkLog,
  PublishLog,
  SyncLog,
} from "@/types"

export type LogStatus = "success" | "failed"
export type LogStatusFilter = "all" | LogStatus

/** Shared filter state for the logs view (some fields only apply to one tab). */
export interface LogFilters {
  searchQuery: string
  statusFilter: LogStatusFilter
  startDate: number | null
  endDate: number | null
  modelFilter: string
  botFilter: string
  channelFilter: string
  searchInDetails: boolean
}

export const DEFAULT_LOG_FILTERS: LogFilters = {
  searchQuery: "",
  statusFilter: "all",
  startDate: null,
  endDate: null,
  modelFilter: "all",
  botFilter: "all",
  channelFilter: "all",
  searchInDetails: false,
}

/** Criteria shared by every per-tab filter function. */
export interface CommonLogFilterCriteria {
  statusFilter: LogStatusFilter
  searchQuery: string
  startDate: number | null
  endDate: number | null
  searchInDetails: boolean
}

export const DAY_MS = 24 * 60 * 60 * 1000

export function matchesStatus(
  status: LogStatus,
  filter: LogStatusFilter,
): boolean {
  return filter === "all" || status === filter
}

/**
 * A timestamp is in range when it is on/after the start of `startDate` and
 * no later than the end of the `endDate` day (endDate + 24h).
 */
export function matchesDateRange(
  timestamp: number,
  startDate: number | null,
  endDate: number | null,
): boolean {
  if (startDate !== null && timestamp < startDate) return false
  if (endDate !== null && timestamp > endDate + DAY_MS) return false
  return true
}

/** Case-insensitive substring match against the JSON serialization of a value. */
export function jsonIncludes(value: unknown, query: string): boolean {
  return value ? JSON.stringify(value).toLowerCase().includes(query) : false
}

// `string | null` because that is what the server actually sends: a nullable
// column (`error`, `textSent`, …) serialises as `null`, not as an absent key.
// The runtime already coped; only the type was wrong. Surfaced by B7.
const includesQuery = (
  text: string | null | undefined,
  query: string,
): boolean => (text ? text.toLowerCase().includes(query) : false)

export function filterPublishLogs(
  logs: PublishLog[],
  filters: CommonLogFilterCriteria & { botFilter: string },
): PublishLog[] {
  return logs.filter((log) => {
    if (!matchesStatus(log.status, filters.statusFilter)) return false
    if (filters.botFilter !== "all" && log.botName !== filters.botFilter)
      return false
    if (!matchesDateRange(log.timestamp, filters.startDate, filters.endDate))
      return false
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase()
      const matchesFields =
        includesQuery(log.botName, q) ||
        includesQuery(log.chatName, q) ||
        includesQuery(log.chatId, q) ||
        includesQuery(log.error, q) ||
        includesQuery(log.textSent, q)
      const matchesDetails =
        filters.searchInDetails &&
        (jsonIncludes(log.fullRequest, q) || jsonIncludes(log.fullResponse, q))
      if (!matchesFields && !matchesDetails) return false
    }
    return true
  })
}

export function filterSyncLogs(
  logs: SyncLog[],
  filters: CommonLogFilterCriteria & { channelFilter: string },
): SyncLog[] {
  return logs.filter((log) => {
    if (!matchesStatus(log.status, filters.statusFilter)) return false
    if (
      filters.channelFilter !== "all" &&
      log.channelName !== filters.channelFilter
    )
      return false
    if (!matchesDateRange(log.timestamp, filters.startDate, filters.endDate))
      return false
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase()
      const matchesFields =
        includesQuery(log.channelName, q) ||
        includesQuery(log.source, q) ||
        includesQuery(log.error, q)
      const matchesDetails =
        filters.searchInDetails &&
        (jsonIncludes(log.fullRequest, q) || jsonIncludes(log.fullResponse, q))
      if (!matchesFields && !matchesDetails) return false
    }
    return true
  })
}

export function filterLlmLogs(
  logs: LLMLog[],
  filters: CommonLogFilterCriteria & { modelFilter: string },
): LLMLog[] {
  return logs.filter((log) => {
    if (!matchesStatus(log.status, filters.statusFilter)) return false
    if (filters.modelFilter !== "all" && log.model !== filters.modelFilter)
      return false
    if (!matchesDateRange(log.timestamp, filters.startDate, filters.endDate))
      return false
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase()
      const matchesFields =
        includesQuery(log.model, q) ||
        includesQuery(log.prompt, q) ||
        includesQuery(log.response, q) ||
        includesQuery(log.error, q)
      const matchesDetails =
        filters.searchInDetails &&
        (jsonIncludes(log.fullRequest, q) || jsonIncludes(log.fullResponse, q))
      if (!matchesFields && !matchesDetails) return false
    }
    return true
  })
}

export function filterNetworkLogs(
  logs: NetworkLog[],
  filters: CommonLogFilterCriteria,
): NetworkLog[] {
  return logs.filter((log) => {
    if (!matchesStatus(log.status, filters.statusFilter)) return false
    if (!matchesDateRange(log.timestamp, filters.startDate, filters.endDate))
      return false
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase()
      const matchesFields =
        includesQuery(log.url, q) ||
        includesQuery(log.method, q) ||
        includesQuery(log.error, q)
      const matchesDetails =
        filters.searchInDetails && jsonIncludes(log.telemetry, q)
      if (!matchesFields && !matchesDetails) return false
    }
    return true
  })
}

export function filterEmbeddingLogs(
  logs: EmbeddingLog[],
  filters: Omit<CommonLogFilterCriteria, "searchInDetails">,
): EmbeddingLog[] {
  return logs.filter((log) => {
    if (!matchesStatus(log.status, filters.statusFilter)) return false
    if (!matchesDateRange(log.timestamp, filters.startDate, filters.endDate))
      return false
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase()
      const matchesText = log.textCount.toString().includes(q)
      const matchesError = includesQuery(log.error, q)
      if (!matchesText && !matchesError) return false
    }
    return true
  })
}

/** Distinct values, alphabetically sorted (used for filter dropdown options). */
export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort()
}

export function isAnyLogFilterActive(filters: LogFilters): boolean {
  return (
    filters.searchQuery !== "" ||
    filters.statusFilter !== "all" ||
    filters.startDate !== null ||
    filters.endDate !== null ||
    filters.modelFilter !== "all" ||
    filters.botFilter !== "all" ||
    filters.channelFilter !== "all" ||
    filters.searchInDetails
  )
}
