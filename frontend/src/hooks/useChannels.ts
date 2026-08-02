import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { SetStateAction } from "react"

import { applySetStateAction } from "@/lib/applySetStateAction"
import { normalizeChannel } from "@/lib/channelNormalize"
import { listChannelsWithStats } from "@/lib/channels/store"
import type { Channel, ChannelStats } from "@/types"

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"

export interface ChannelsQueryResult {
  channels: Channel[]
  channelStats: Record<string, ChannelStats>
}

async function fetchChannels(): Promise<ChannelsQueryResult> {
  const { channels, stats } = await listChannelsWithStats()
  return {
    channels: channels.map(normalizeChannel),
    channelStats: stats,
  }
}

export function useChannelsQuery() {
  return useQuery({
    queryKey: queryKeys.channels,
    queryFn: fetchChannels,
    staleTime: SUMMARIZER_STALE_TIME,
    refetchOnWindowFocus: true,
  })
}

export function useInvalidateChannels() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.channels })
}

/**
 * Write-through for the `channels` half of the channels cache entry,
 * preserving `channelStats`. Applies `useState`-setter semantics; when the
 * cache is empty the action is applied to an empty base so optimistic writes
 * before the first fetch are not dropped.
 */
export function setChannelsInCache(
  queryClient: QueryClient,
  action: SetStateAction<Channel[]>,
): void {
  queryClient.setQueryData<ChannelsQueryResult>(queryKeys.channels, (old) => ({
    channels: applySetStateAction(action, old?.channels ?? []),
    channelStats: old?.channelStats ?? {},
  }))
}

/**
 * Write-through for the `channelStats` half of the channels cache entry,
 * preserving `channels`.
 */
export function setChannelStatsInCache(
  queryClient: QueryClient,
  action: SetStateAction<Record<string, ChannelStats>>,
): void {
  queryClient.setQueryData<ChannelsQueryResult>(queryKeys.channels, (old) => ({
    channels: old?.channels ?? [],
    channelStats: applySetStateAction(action, old?.channelStats ?? {}),
  }))
}
