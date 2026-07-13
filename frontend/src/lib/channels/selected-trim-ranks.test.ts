import { describe, expect, it } from "bun:test"

import { buildSelectedTrimRanks } from "@/lib/channels/selected-trim-ranks"
import type { Channel } from "@/types"

const makeChannel = (name: string, lastUpdated: number): Channel => ({
  id: name,
  name,
  tags: [],
  lastUpdated,
  followedAt: 0,
})

const channels: Channel[] = [
  makeChannel("oldest", 10),
  makeChannel("middle", 20),
  makeChannel("newest", 30),
]

describe("buildSelectedTrimRanks", () => {
  it("ranks only selected channels, 1-based, by current sort order", () => {
    const ranks = buildSelectedTrimRanks({
      channels,
      channelStats: {},
      postsInScopeCounts: {},
      selectedChannels: new Set(["oldest", "newest"]),
      sortBy: "last_updated",
      sortDirection: "desc",
    })

    expect(ranks.get("newest")).toBe(1)
    expect(ranks.get("oldest")).toBe(2)
    expect(ranks.has("middle")).toBe(false)
    expect(ranks.size).toBe(2)
  })

  it("respects sort direction", () => {
    const ranks = buildSelectedTrimRanks({
      channels,
      channelStats: {},
      postsInScopeCounts: {},
      selectedChannels: new Set(["oldest", "newest"]),
      sortBy: "last_updated",
      sortDirection: "asc",
    })

    expect(ranks.get("oldest")).toBe(1)
    expect(ranks.get("newest")).toBe(2)
  })

  it("returns an empty map when nothing is selected", () => {
    const ranks = buildSelectedTrimRanks({
      channels,
      channelStats: {},
      postsInScopeCounts: {},
      selectedChannels: new Set(),
      sortBy: "last_updated",
      sortDirection: "desc",
    })

    expect(ranks.size).toBe(0)
  })
})
