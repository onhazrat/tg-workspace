import { describe, expect, it } from "bun:test"

import type { Channel, ChannelStats } from "@/types"

import { trimSelectedChannelsToCount } from "./trim-selected-channels"

function makeChannel(
  name: string,
  overrides: Partial<Channel> = {},
): Channel {
  return {
    id: name,
    name,
    lastUpdated: 0,
    followedAt: 0,
    ...overrides,
  }
}

const channels: Channel[] = [
  makeChannel("low-activity", { lastUpdated: 1 }),
  makeChannel("mid-activity", { lastUpdated: 2 }),
  makeChannel("high-activity", { lastUpdated: 3 }),
  makeChannel("hidden-selected", { lastUpdated: 4 }),
  makeChannel("unselected", { lastUpdated: 5 }),
]

const channelStats: Record<string, ChannelStats> = {
  "low-activity": { count: 1, minId: 1, maxId: 1, velocity: 1 },
  "mid-activity": { count: 2, minId: 1, maxId: 2, velocity: 5 },
  "high-activity": { count: 3, minId: 1, maxId: 3, velocity: 10 },
  "hidden-selected": { count: 4, minId: 1, maxId: 4, velocity: 7 },
  "unselected": { count: 5, minId: 1, maxId: 5, velocity: 20 },
}

const selectedChannels = new Set([
  "low-activity",
  "mid-activity",
  "high-activity",
  "hidden-selected",
])

describe("trimSelectedChannelsToCount", () => {
  it("keeps lowest-velocity channels when sorting activity rate ascending", () => {
    const result = trimSelectedChannelsToCount({
      channels,
      channelStats,
      selectedChannels,
      sortBy: "activity_rate",
      sortDirection: "asc",
      count: 2,
    })

    expect(result).toEqual({
      status: "applied",
      previousCount: 4,
      nextCount: 2,
      keptNames: ["low-activity", "mid-activity"],
    })
  })

  it("keeps highest-velocity channels when sorting activity rate descending", () => {
    const result = trimSelectedChannelsToCount({
      channels,
      channelStats,
      selectedChannels,
      sortBy: "activity_rate",
      sortDirection: "desc",
      count: 2,
    })

    expect(result).toEqual({
      status: "applied",
      previousCount: 4,
      nextCount: 2,
      keptNames: ["high-activity", "hidden-selected"],
    })
  })

  it("returns noop when N is greater than or equal to selected count", () => {
    const result = trimSelectedChannelsToCount({
      channels,
      channelStats,
      selectedChannels,
      sortBy: "activity_rate",
      sortDirection: "asc",
      count: 4,
    })

    expect(result).toEqual({
      status: "noop",
      reason: "already_within_limit",
      selectedCount: 4,
    })
  })

  it("returns noop for invalid counts", () => {
    expect(
      trimSelectedChannelsToCount({
        channels,
        channelStats,
        selectedChannels,
        sortBy: "activity_rate",
        sortDirection: "asc",
        count: 0,
      }),
    ).toEqual({
      status: "noop",
      reason: "invalid_count",
      selectedCount: 4,
    })

    expect(
      trimSelectedChannelsToCount({
        channels,
        channelStats,
        selectedChannels,
        sortBy: "activity_rate",
        sortDirection: "asc",
        count: Number.NaN,
      }),
    ).toEqual({
      status: "noop",
      reason: "invalid_count",
      selectedCount: 4,
    })
  })

  it("returns noop for empty selection", () => {
    expect(
      trimSelectedChannelsToCount({
        channels,
        channelStats,
        selectedChannels: new Set(),
        sortBy: "activity_rate",
        sortDirection: "asc",
        count: 2,
      }),
    ).toEqual({
      status: "noop",
      reason: "empty_selection",
      selectedCount: 0,
    })
  })

  it("ranks filter-hidden selected channels from the full channel list", () => {
    const result = trimSelectedChannelsToCount({
      channels,
      channelStats,
      selectedChannels,
      sortBy: "activity_rate",
      sortDirection: "desc",
      count: 3,
    })

    expect(result).toEqual({
      status: "applied",
      previousCount: 4,
      nextCount: 3,
      keptNames: ["high-activity", "hidden-selected", "mid-activity"],
    })
  })

  it("never includes unselected channels in the result", () => {
    const result = trimSelectedChannelsToCount({
      channels,
      channelStats,
      selectedChannels,
      sortBy: "activity_rate",
      sortDirection: "desc",
      count: 1,
    })

    expect(result.status).toBe("applied")
    if (result.status !== "applied") return
    expect(result.keptNames).not.toContain("unselected")
    expect(result.keptNames).toEqual(["high-activity"])
  })
})
