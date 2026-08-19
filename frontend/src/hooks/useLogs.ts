import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/api"
import type { LogSearch, LogType } from "@/api/data"
import type {
  EmbeddingLog,
  LLMLogListItem,
  NetworkLog,
  PublishLogListItem,
  SyncLogListItem,
} from "@/types"

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"

/**
 * Server state for the five log panels.
 *
 * A3 moved the reads off `lib/repository.ts`: they went through
 * `listWithStaleCheck`, which compared a per-resource etag against
 * `localStorage` and fell back to an IndexedDB mirror. react-query already
 * de-duplicates in-flight requests and tracks staleness, so all of that was a
 * second cache shadowing the first.
 *
 * Freshness after a write is now **explicit**. It used to be implicit in the
 * etag bump `repository.apiWrite` performed; `staleTime` does not replace that,
 * because it decides when a refetch is *allowed*, not when one is *needed*.
 * Every write path — the mutation below, and `lib/logs/write.ts` for the
 * non-React callers — invalidates the matching key itself.
 */

/** Newest first. The server does not promise an order. */
function sortByTimestamp<T extends { timestamp: number }>(logs: T[]): T[] {
  return [...logs].sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * Read one log list, newest first.
 *
 * Exported because `DataContext` needs the identical fetcher for its imperative
 * `loadXLogs()` reloads — when it built its own, the sort was duplicated five
 * times and could drift from this one.
 */
export async function fetchLogs(
  type: LogType,
  list: LogLister = api.listLogs,
  search?: LogSearch,
): Promise<{ timestamp: number }[]> {
  return sortByTimestamp(await list<{ timestamp: number }>(type, search))
}

/**
 * Test seam for the transport only — the sort above always applies.
 *
 * Injected rather than mocked because Bun's module mocks are process-wide (see
 * `LogPoster` in `lib/logs/write.ts`), and stubbing the global `fetch` instead
 * leaks across test files.
 */
export type LogLister = <T>(type: LogType, search?: LogSearch) => Promise<T[]>

export type LogsQueryOptions = {
  /** Poll interval in ms. Omit for no polling. */
  refetchInterval?: number
  /** Test seam; see `LogLister`. */
  lister?: LogLister
  /**
   * Server-side text search. Part of the query key, so changing it refetches —
   * it has to, because the match now happens in SQL over the whole table
   * rather than in the browser over the page that was already fetched.
   */
  search?: LogSearch
}

export function useLogsQuery(
  type: LogType,
  enabled = false,
  options: LogsQueryOptions = {},
) {
  const search = options.search?.query ? options.search : undefined
  return useQuery({
    queryKey: [
      ...queryKeys.logs[type],
      search?.query ?? "",
      search?.inDetails ?? false,
    ],
    queryFn: () => fetchLogs(type, options.lister, search),
    staleTime: SUMMARIZER_STALE_TIME,
    enabled,
    refetchInterval: options.refetchInterval,
  })
}

export function usePublishLogsQuery(
  enabled = false,
  options: LogsQueryOptions = {},
) {
  return useLogsQuery("publish", enabled, options) as ReturnType<
    typeof useQuery<PublishLogListItem[]>
  >
}

export function useSyncLogsQuery(
  enabled = false,
  options: LogsQueryOptions = {},
) {
  return useLogsQuery("sync", enabled, options) as ReturnType<
    typeof useQuery<SyncLogListItem[]>
  >
}

export function useLLMLogsQuery(
  enabled = false,
  options: LogsQueryOptions = {},
) {
  return useLogsQuery("llm", enabled, options) as ReturnType<
    typeof useQuery<LLMLogListItem[]>
  >
}

export function useEmbeddingLogsQuery(
  enabled = false,
  options: LogsQueryOptions = {},
) {
  return useLogsQuery("embedding", enabled, options) as ReturnType<
    typeof useQuery<EmbeddingLog[]>
  >
}

export function useNetworkLogsQuery(
  enabled = false,
  options: LogsQueryOptions = {},
) {
  return useLogsQuery("network", enabled, options) as ReturnType<
    typeof useQuery<NetworkLog[]>
  >
}

/**
 * The bodies for one expanded log row.
 *
 * The list projection stopped carrying `fullRequest` / `fullResponse` (and, for
 * LLM logs, the prompt and response): `GET /data/logs/sync` was **56.28 MB for
 * a page of 500 rows, 99.7% of it bodies**, and the viewer renders none of it
 * until a row is expanded — one row at a time. So the row that is open fetches
 * its own detail.
 *
 * `enabled` is the whole mechanism: passing `null` for a collapsed row means no
 * request. Query keys are per row, so collapsing and reopening is a cache hit
 * rather than a second fetch, and `staleTime` keeps it that way — a log row is
 * immutable once written.
 */
export function useLogDetailQuery<T>(type: LogType, id: string | null) {
  return useQuery({
    queryKey: queryKeys.logDetail(type, id ?? ""),
    queryFn: () => api.getLog<T>(type, id as string),
    enabled: id !== null,
    staleTime: Infinity,
  })
}

/**
 * Delete one entry, or clear a whole panel.
 *
 * One mutation covers both, because the server takes one endpoint for both
 * (`deleteLogs({type, logId | clearAll})`, collapsed in D1/D2) and the cache
 * effect is identical.
 *
 * Unlike the writes in `lib/logs/write.ts`, these **do** throw: the operator
 * asked for the deletion, so a failure has to reach them.
 */
export function useDeleteLogsMutation(type: LogType) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (target: { logId: string } | { clearAll: true }) =>
      api.deleteLogs({ type, ...target }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.logs[type] }),
  })
}
