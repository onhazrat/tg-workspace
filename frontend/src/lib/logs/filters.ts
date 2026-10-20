import type { TimeBound } from "@/lib/time-bound/bound"
import type {
  EmbeddingLog,
  LLMLogListItem,
  NetworkLog,
  PublishLogListItem,
  SyncLogListItem,
} from "@/types"

/**
 * Client-side log filtering — **everything except the text search**.
 *
 * The text query moved to SQL (`GET /data/logs/{type}?search=…`). It had to:
 * the list stopped carrying `fullRequest` / `fullResponse` and the LLM prompt
 * and response, so "search in details" had nothing left to match here. The
 * saving was 56.28 MB per page of sync logs, 99.7% of it those bodies.
 *
 * **These functions must not re-apply the query.** The server matches
 * `fields OR bodies`; a second pass over fields alone would drop exactly the
 * rows that matched only on a body — the ones "search in details" exists for.
 *
 * What stays here is what is cheap and already present: status and the
 * bot/channel/model dropdowns. The Logged Time bound went to the server too
 * (TB-05): bounding the newest page missed every older entry.
 */

export type LogStatus = "success" | "failed"
export type LogStatusFilter = "all" | LogStatus

/** Shared filter state for the logs view (some fields only apply to one tab). */
export interface LogFilters {
  searchQuery: string
  statusFilter: LogStatusFilter
  /** When entries were logged; the server applies it (TB-05). */
  timeBound: TimeBound
  modelFilter: string
  botFilter: string
  channelFilter: string
  searchInDetails: boolean
}

export const DEFAULT_LOG_FILTERS: LogFilters = {
  searchQuery: "",
  statusFilter: "all",
  timeBound: { mode: "live" },
  modelFilter: "all",
  botFilter: "all",
  channelFilter: "all",
  searchInDetails: false,
}

/** Criteria shared by every per-tab filter function. */
export interface CommonLogFilterCriteria {
  statusFilter: LogStatusFilter
  searchQuery: string
  searchInDetails: boolean
}

export function matchesStatus(
  status: LogStatus,
  filter: LogStatusFilter,
): boolean {
  return filter === "all" || status === filter
}

/**
 * Case-insensitive substring match against the JSON serialization of a value.
 *
 * No longer used by the log filters — the text search moved to SQL when the
 * list stopped carrying the bodies there was nothing left to match. Kept
 * exported because it is a general helper and is covered by its own tests.
 */
export function jsonIncludes(value: unknown, query: string): boolean {
  return value ? JSON.stringify(value).toLowerCase().includes(query) : false
}

export function filterPublishLogs(
  logs: PublishLogListItem[],
  filters: CommonLogFilterCriteria & { botFilter: string },
): PublishLogListItem[] {
  return logs.filter((log) => {
    if (!matchesStatus(log.status, filters.statusFilter)) return false
    if (filters.botFilter !== "all" && log.botName !== filters.botFilter)
      return false
    return true
  })
}

export function filterSyncLogs(
  logs: SyncLogListItem[],
  filters: CommonLogFilterCriteria & { channelFilter: string },
): SyncLogListItem[] {
  return logs.filter((log) => {
    if (!matchesStatus(log.status, filters.statusFilter)) return false
    if (
      filters.channelFilter !== "all" &&
      log.channelName !== filters.channelFilter
    )
      return false
    return true
  })
}

export function filterLlmLogs(
  logs: LLMLogListItem[],
  filters: CommonLogFilterCriteria & { modelFilter: string },
): LLMLogListItem[] {
  return logs.filter((log) => {
    if (!matchesStatus(log.status, filters.statusFilter)) return false
    if (filters.modelFilter !== "all" && log.model !== filters.modelFilter)
      return false
    return true
  })
}

export function filterNetworkLogs(
  logs: NetworkLog[],
  filters: CommonLogFilterCriteria,
): NetworkLog[] {
  return logs.filter((log) => {
    if (!matchesStatus(log.status, filters.statusFilter)) return false
    return true
  })
}

export function filterEmbeddingLogs(
  logs: EmbeddingLog[],
  filters: Omit<CommonLogFilterCriteria, "searchInDetails">,
): EmbeddingLog[] {
  return logs.filter((log) => {
    if (!matchesStatus(log.status, filters.statusFilter)) return false
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
    filters.timeBound.start !== undefined ||
    filters.timeBound.end !== undefined ||
    filters.modelFilter !== "all" ||
    filters.botFilter !== "all" ||
    filters.channelFilter !== "all" ||
    filters.searchInDetails
  )
}
