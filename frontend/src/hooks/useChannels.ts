import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { SetStateAction } from "react"

import { applySetStateAction } from "@/lib/applySetStateAction"
import { normalizeChannel } from "@/lib/channelNormalize"
import {
  listChannelBios,
  listChannelStats,
  listChannels,
} from "@/lib/channels/store"
import type { Channel, ChannelStats } from "@/types"

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"

/**
 * Channels and their stats are **two queries, deliberately**.
 *
 * They used to be one cache entry filled by one request
 * (`listChannels({ includeStats: true })`). The stats half cost 2.36s of a 3.13s
 * response — two aggregate queries over every post row — for 46KB of a 536KB
 * payload, and the Channels grid could not paint until all of it landed. Only
 * `activity_rate` and `total_posts` read stats, two of eleven sort options and
 * not the default.
 *
 * Split, the grid renders from `useChannelsQuery` (0.78s) and stats arrive when
 * they arrive. The two stats-dependent sorts re-sort on arrival rather than
 * holding the first paint hostage.
 *
 * The cache shape already anticipated this: `setChannelsInCache` and
 * `setChannelStatsInCache` were always independent write-throughs, so the
 * seventeen optimistic call sites did not have to change.
 */
export function useChannelsQuery() {
  return useQuery({
    queryKey: queryKeys.channels,
    queryFn: async () => (await listChannels()).map(normalizeChannel),
    staleTime: SUMMARIZER_STALE_TIME,
    refetchOnWindowFocus: true,
  })
}

export function useChannelStatsQuery() {
  return useQuery({
    queryKey: queryKeys.channelStats,
    // Wrapped, not passed by reference: react-query calls `queryFn` with a
    // context object, which would bind to `listChannelStats`'s optional
    // injected-client parameter.
    queryFn: () => listChannelStats(),
    staleTime: SUMMARIZER_STALE_TIME,
    refetchOnWindowFocus: true,
  })
}

export function useChannelBiosQuery() {
  return useQuery({
    queryKey: queryKeys.channelBios,
    queryFn: () => listChannelBios(),
    staleTime: SUMMARIZER_STALE_TIME,
    refetchOnWindowFocus: true,
  })
}

export function useInvalidateChannels() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.channels }),
      queryClient.invalidateQueries({ queryKey: queryKeys.channelStats }),
      queryClient.invalidateQueries({ queryKey: queryKeys.channelBios }),
    ])
}

/**
 * Write-through for the channel list. Applies `useState`-setter semantics; when
 * the cache is empty the action is applied to an empty base so optimistic writes
 * before the first fetch are not dropped.
 */
export function setChannelsInCache(
  queryClient: QueryClient,
  action: SetStateAction<Channel[]>,
): void {
  queryClient.setQueryData<Channel[]>(queryKeys.channels, (old) =>
    applySetStateAction(action, old ?? []),
  )
}

/** Write-through for the stats map, same semantics. */
export function setChannelStatsInCache(
  queryClient: QueryClient,
  action: SetStateAction<Record<string, ChannelStats>>,
): void {
  queryClient.setQueryData<Record<string, ChannelStats>>(
    queryKeys.channelStats,
    (old) => applySetStateAction(action, old ?? {}),
  )
}
