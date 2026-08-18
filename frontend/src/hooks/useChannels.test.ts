import { describe, expect, it } from "bun:test"
import { QueryClient } from "@tanstack/react-query"

import { queryKeys } from "@/hooks/queryKeys"
import { setChannelStatsInCache, setChannelsInCache } from "@/hooks/useChannels"
import type { Channel, ChannelStats } from "@/types"

/**
 * The two write-throughs, after channels and stats became separate queries.
 *
 * They used to share one cache entry — `{ channels, channelStats }` — filled by
 * one request, and each setter had to carry the other half through untouched.
 * The stats half cost 2.36s of a 3.13s response for 46KB of a 536KB payload and
 * held up the grid's first paint, so it moved to its own query key.
 *
 * The "preserves the other half" assertions are kept rather than deleted: they
 * are what the seventeen optimistic call sites depend on, and they should now
 * hold *structurally* rather than by careful copying. A regression that merged
 * the two entries again would have to pass them.
 */

const channelA: Channel = { id: "1", name: "alpha" }
const channelB: Channel = { id: "2", name: "beta" }
const statsA: ChannelStats = { count: 3, minId: 1, maxId: 3 }
const statsB: ChannelStats = { count: 5, minId: 2, maxId: 9 }

const readChannels = (qc: QueryClient) =>
  qc.getQueryData<Channel[]>(queryKeys.channels)
const readStats = (qc: QueryClient) =>
  qc.getQueryData<Record<string, ChannelStats>>(queryKeys.channelStats)

describe("setChannelsInCache", () => {
  it("applies an updater to an empty base when the cache is unpopulated", () => {
    const queryClient = new QueryClient()
    setChannelsInCache(queryClient, (prev) => [...prev, channelA])
    expect(readChannels(queryClient)).toEqual([channelA])
  })

  it("replaces channels with a plain value action", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<Channel[]>(queryKeys.channels, [channelA])
    setChannelsInCache(queryClient, [channelB])
    expect(readChannels(queryClient)).toEqual([channelB])
  })

  it("applies an updater to existing channels", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<Channel[]>(queryKeys.channels, [channelA])
    setChannelsInCache(queryClient, (prev) => [...prev, channelB])
    expect(readChannels(queryClient)).toEqual([channelA, channelB])
  })

  it("leaves the stats entry alone", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(queryKeys.channelStats, { alpha: statsA })
    setChannelsInCache(queryClient, [channelB])
    expect(readStats(queryClient)).toEqual({ alpha: statsA })
  })
})

describe("setChannelStatsInCache", () => {
  it("applies an updater to an empty base when the cache is unpopulated", () => {
    const queryClient = new QueryClient()
    setChannelStatsInCache(queryClient, (prev) => ({ ...prev, alpha: statsA }))
    expect(readStats(queryClient)).toEqual({ alpha: statsA })
  })

  it("merges stats via updater", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(queryKeys.channelStats, { alpha: statsA })
    setChannelStatsInCache(queryClient, (prev) => ({ ...prev, beta: statsB }))
    expect(readStats(queryClient)).toEqual({ alpha: statsA, beta: statsB })
  })

  it("replaces stats with a plain value action", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(queryKeys.channelStats, { alpha: statsA })
    setChannelStatsInCache(queryClient, { beta: statsB })
    expect(readStats(queryClient)).toEqual({ beta: statsB })
  })

  it("leaves the channel list alone", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<Channel[]>(queryKeys.channels, [channelA])
    setChannelStatsInCache(queryClient, { beta: statsB })
    expect(readChannels(queryClient)).toEqual([channelA])
  })

  it("keeps both halves intact across interleaved writes", () => {
    const queryClient = new QueryClient()
    setChannelsInCache(queryClient, [channelA])
    setChannelStatsInCache(queryClient, { alpha: statsA })
    setChannelsInCache(queryClient, (prev) => [...prev, channelB])
    expect(readChannels(queryClient)).toEqual([channelA, channelB])
    expect(readStats(queryClient)).toEqual({ alpha: statsA })
  })

  it("stats can arrive before channels — the grid paints either order", () => {
    // The whole point of the split: these are independent requests now, and the
    // stats response is small and often lands first.
    const queryClient = new QueryClient()
    setChannelStatsInCache(queryClient, { alpha: statsA })
    expect(readChannels(queryClient)).toBeUndefined()
    setChannelsInCache(queryClient, [channelA])
    expect(readStats(queryClient)).toEqual({ alpha: statsA })
  })
})
