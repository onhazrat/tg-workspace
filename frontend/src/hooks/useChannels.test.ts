import { describe, expect, it } from "bun:test"
import { QueryClient } from "@tanstack/react-query"

import { queryKeys } from "@/hooks/queryKeys"
import {
  type ChannelsQueryResult,
  setChannelStatsInCache,
  setChannelsInCache,
} from "@/hooks/useChannels"
import type { Channel, ChannelStats } from "@/types"

const channelA: Channel = { id: "1", name: "alpha" }
const channelB: Channel = { id: "2", name: "beta" }
const statsA: ChannelStats = { count: 3, minId: 1, maxId: 3 }
const statsB: ChannelStats = { count: 5, minId: 2, maxId: 9 }

function readCache(queryClient: QueryClient): ChannelsQueryResult | undefined {
  return queryClient.getQueryData<ChannelsQueryResult>(queryKeys.channels)
}

describe("setChannelsInCache", () => {
  it("applies an updater to an empty base when the cache is unpopulated", () => {
    const queryClient = new QueryClient()
    setChannelsInCache(queryClient, (prev) => [...prev, channelA])
    expect(readCache(queryClient)).toEqual({
      channels: [channelA],
      channelStats: {},
    })
  })

  it("replaces channels with a plain value action", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<ChannelsQueryResult>(queryKeys.channels, {
      channels: [channelA],
      channelStats: { alpha: statsA },
    })
    setChannelsInCache(queryClient, [channelB])
    expect(readCache(queryClient)).toEqual({
      channels: [channelB],
      channelStats: { alpha: statsA },
    })
  })

  it("applies an updater to existing channels and preserves channelStats", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<ChannelsQueryResult>(queryKeys.channels, {
      channels: [channelA],
      channelStats: { alpha: statsA },
    })
    setChannelsInCache(queryClient, (prev) => [...prev, channelB])
    expect(readCache(queryClient)).toEqual({
      channels: [channelA, channelB],
      channelStats: { alpha: statsA },
    })
  })
})

describe("setChannelStatsInCache", () => {
  it("applies an updater to an empty base when the cache is unpopulated", () => {
    const queryClient = new QueryClient()
    setChannelStatsInCache(queryClient, (prev) => ({ ...prev, alpha: statsA }))
    expect(readCache(queryClient)).toEqual({
      channels: [],
      channelStats: { alpha: statsA },
    })
  })

  it("merges stats via updater and preserves channels", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<ChannelsQueryResult>(queryKeys.channels, {
      channels: [channelA, channelB],
      channelStats: { alpha: statsA },
    })
    setChannelStatsInCache(queryClient, (prev) => ({ ...prev, beta: statsB }))
    expect(readCache(queryClient)).toEqual({
      channels: [channelA, channelB],
      channelStats: { alpha: statsA, beta: statsB },
    })
  })

  it("replaces stats with a plain value action", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<ChannelsQueryResult>(queryKeys.channels, {
      channels: [channelA],
      channelStats: { alpha: statsA },
    })
    setChannelStatsInCache(queryClient, { beta: statsB })
    expect(readCache(queryClient)).toEqual({
      channels: [channelA],
      channelStats: { beta: statsB },
    })
  })

  it("last write wins across interleaved channel and stats writes", () => {
    const queryClient = new QueryClient()
    setChannelsInCache(queryClient, [channelA])
    setChannelStatsInCache(queryClient, { alpha: statsA })
    setChannelsInCache(queryClient, (prev) => [...prev, channelB])
    expect(readCache(queryClient)).toEqual({
      channels: [channelA, channelB],
      channelStats: { alpha: statsA },
    })
  })
})
