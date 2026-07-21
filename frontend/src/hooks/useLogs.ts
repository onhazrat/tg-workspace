import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  listEmbeddingLogs,
  listLLMLogs,
  listNetworkLogs,
  listPublishLogs,
  listSyncLogs,
} from "@/lib/repository"
import type {
  EmbeddingLog,
  LLMLog,
  NetworkLog,
  PublishLog,
  SyncLog,
} from "@/types"

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"

type LogType = keyof typeof queryKeys.logs

const fetchers: Record<LogType, () => Promise<unknown[]>> = {
  publish: listPublishLogs,
  sync: listSyncLogs,
  llm: listLLMLogs,
  embedding: listEmbeddingLogs,
  network: listNetworkLogs,
}

function sortByTimestamp<T extends { timestamp: number }>(logs: T[]): T[] {
  return [...logs].sort((a, b) => b.timestamp - a.timestamp)
}

export type LogsQueryOptions = {
  /** Poll interval in ms. Omit for no polling. */
  refetchInterval?: number
}

export function useLogsQuery(
  type: LogType,
  enabled = false,
  options: LogsQueryOptions = {},
) {
  return useQuery({
    queryKey: queryKeys.logs[type],
    queryFn: async () =>
      sortByTimestamp((await fetchers[type]()) as { timestamp: number }[]),
    staleTime: SUMMARIZER_STALE_TIME,
    enabled,
    refetchInterval: options.refetchInterval,
  })
}

export function usePublishLogsQuery(enabled = false) {
  return useLogsQuery("publish", enabled) as ReturnType<
    typeof useQuery<PublishLog[]>
  >
}

export function useSyncLogsQuery(enabled = false) {
  return useLogsQuery("sync", enabled) as ReturnType<typeof useQuery<SyncLog[]>>
}

export function useLLMLogsQuery(enabled = false) {
  return useLogsQuery("llm", enabled) as ReturnType<typeof useQuery<LLMLog[]>>
}

export function useEmbeddingLogsQuery(enabled = false) {
  return useLogsQuery("embedding", enabled) as ReturnType<
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

export function useInvalidateLogs() {
  const queryClient = useQueryClient()
  return (type?: LogType) => {
    if (type) {
      return queryClient.invalidateQueries({ queryKey: queryKeys.logs[type] })
    }
    return Promise.all(
      (Object.keys(queryKeys.logs) as LogType[]).map((t) =>
        queryClient.invalidateQueries({ queryKey: queryKeys.logs[t] }),
      ),
    )
  }
}
