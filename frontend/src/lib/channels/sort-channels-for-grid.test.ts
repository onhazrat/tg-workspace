import { describe, expect, it } from "bun:test"

import type { Channel, ChannelStats, Post } from "@/types"

import {
  buildPostsInScopeCounts,
  type ChannelGridSortOption,
  sortChannelsForGrid,
} from "./sort-channels-for-grid"

function makeChannel(name: string, overrides: Partial<Channel> = {}): Channel {
  return {
    id: name,
    name,
    lastUpdated: 0,
    followedAt: 0,
    ...overrides,
  }
}

function makePost(channelName: string, id: string): Post {
  return {
    id,
    channelName,
    text: "",
    date: 0,
    messageId: 1,
  }
}

const channels: Channel[] = [
  makeChannel("alpha"),
  makeChannel("beta"),
  makeChannel("gamma"),
]

const channelStats: Record<string, ChannelStats> = {
  alpha: { count: 100, minId: 1, maxId: 100, velocity: 1 },
  beta: { count: 10, minId: 1, maxId: 10, velocity: 5 },
  gamma: { count: 50, minId: 1, maxId: 50, velocity: 3 },
}

const selectedChannels = new Set(["alpha", "beta", "gamma"])

describe("buildPostsInScopeCounts", () => {
  it("counts filtered posts per channel name", () => {
    const filteredPosts = [
      makePost("alpha", "a1"),
      makePost("alpha", "a2"),
      makePost("beta", "b1"),
    ]

    expect(buildPostsInScopeCounts(filteredPosts)).toEqual({
      alpha: 2,
      beta: 1,
    })
  })
})

describe("sortChannelsForGrid posts_in_scope", () => {
  const postsInScopeCounts = {
    alpha: 2,
    beta: 5,
    gamma: 1,
  }

  it("sorts by in-scope post count ascending within selection tier", () => {
    const sorted = sortChannelsForGrid({
      channels,
      channelStats,
      postsInScopeCounts,
      selectedChannels,
      sortBy: "posts_in_scope",
      sortDirection: "asc",
    })

    expect(sorted.map((channel) => channel.name)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ])
  })

  it("sorts by in-scope post count descending within selection tier", () => {
    const sorted = sortChannelsForGrid({
      channels,
      channelStats,
      postsInScopeCounts,
      selectedChannels,
      sortBy: "posts_in_scope",
      sortDirection: "desc",
    })

    expect(sorted.map((channel) => channel.name)).toEqual([
      "beta",
      "alpha",
      "gamma",
    ])
  })

  it("differs from total_posts when scraped totals diverge from filtered counts", () => {
    const byTotalPosts = sortChannelsForGrid({
      channels,
      channelStats,
      postsInScopeCounts,
      selectedChannels,
      sortBy: "total_posts",
      sortDirection: "desc",
    })
    const byPostsInScope = sortChannelsForGrid({
      channels,
      channelStats,
      postsInScopeCounts,
      selectedChannels,
      sortBy: "posts_in_scope",
      sortDirection: "desc",
    })

    expect(byTotalPosts.map((channel) => channel.name)).toEqual([
      "alpha",
      "gamma",
      "beta",
    ])
    expect(byPostsInScope.map((channel) => channel.name)).toEqual([
      "beta",
      "alpha",
      "gamma",
    ])
  })
})

function sortNames(
  list: Channel[],
  sortBy: ChannelGridSortOption,
  sortDirection: "asc" | "desc" = "asc",
  selected: Set<string> = new Set(list.map((channel) => channel.name)),
): string[] {
  return sortChannelsForGrid({
    channels: list,
    channelStats,
    selectedChannels: selected,
    sortBy,
    sortDirection,
  }).map((channel) => channel.name)
}

describe("sortChannelsForGrid sort options", () => {
  it.each<[ChannelGridSortOption, Channel[], string[]]>([
    ["activity_rate", channels, ["alpha", "gamma", "beta"]],
    ["total_posts", channels, ["beta", "gamma", "alpha"]],
    [
      "last_updated",
      [
        makeChannel("a", { lastUpdated: 3 }),
        makeChannel("b", { lastUpdated: 1 }),
      ],
      ["b", "a"],
    ],
    [
      "followed_at",
      [
        makeChannel("a", { followedAt: 9 }),
        makeChannel("b", { followedAt: 2 }),
      ],
      ["b", "a"],
    ],
    [
      "channel_id",
      [
        makeChannel("a", { startId: 50 }),
        makeChannel("b"),
        makeChannel("c", { startId: 7 }),
      ],
      ["b", "c", "a"],
    ],
    [
      "channel_name",
      [makeChannel("zeta", { displayName: "Alpha" }), makeChannel("beta")],
      ["zeta", "beta"],
    ],
    [
      "subscribers",
      [
        makeChannel("a", { subscribers: 10 }),
        makeChannel("b"),
        makeChannel("c", { subscribers: 5 }),
      ],
      ["b", "c", "a"],
    ],
  ])("%s sorts ascending, and desc reverses it", (sortBy, list, expected) => {
    expect(sortNames(list, sortBy)).toEqual(expected)
    expect(sortNames(list, sortBy, "desc")).toEqual([...expected].reverse())
  })

  it("counts a channel with no stats as zero", () => {
    const list = [makeChannel("alpha"), makeChannel("unknown")]
    expect(sortNames(list, "total_posts")).toEqual(["unknown", "alpha"])
    expect(sortNames(list, "activity_rate")).toEqual(["unknown", "alpha"])
  })

  it("puts a missing sync time last in ascending order", () => {
    const list = [
      makeChannel("none"),
      makeChannel("late", { nextRegularSyncAt: 20, nextDynamicSyncAt: 5 }),
      makeChannel("early", { nextRegularSyncAt: 10, nextDynamicSyncAt: 30 }),
      makeChannel("never", {
        nextRegularSyncAt: null,
        nextDynamicSyncAt: null,
      }),
    ]
    expect(sortNames(list, "next_regular_sync")).toEqual([
      "early",
      "late",
      "never",
      "none",
    ])
    expect(sortNames(list, "next_dynamic_sync")).toEqual([
      "late",
      "early",
      "never",
      "none",
    ])
  })

  it("next_auto_sync takes the earlier deadline of the enabled modes only", () => {
    const list = [
      // Regular sync is on unless switched off; dynamic only when switched on.
      makeChannel("regular-default", {
        nextRegularSyncAt: 40,
        nextDynamicSyncAt: 1,
      }),
      makeChannel("both", {
        dynamicSyncEnabled: true,
        nextRegularSyncAt: 50,
        nextDynamicSyncAt: 20,
      }),
      makeChannel("regular-off", {
        regularSyncEnabled: false,
        dynamicSyncEnabled: true,
        nextRegularSyncAt: 1,
        nextDynamicSyncAt: 30,
      }),
      makeChannel("all-off", {
        regularSyncEnabled: false,
        nextRegularSyncAt: 2,
        nextDynamicSyncAt: 3,
      }),
      makeChannel("dynamic-no-deadline", {
        regularSyncEnabled: false,
        dynamicSyncEnabled: true,
      }),
    ]
    expect(sortNames(list, "next_auto_sync")).toEqual([
      "both",
      "regular-off",
      "regular-default",
      "all-off",
      "dynamic-no-deadline",
    ])
  })

  it("an unknown sort key falls back to the name", () => {
    const list = [makeChannel("b"), makeChannel("a")]
    for (const key of ["bogus", "constructor"]) {
      expect(sortNames(list, key as ChannelGridSortOption)).toEqual(["a", "b"])
    }
  })

  it("ranks selected, then unselected, then frozen, whatever the direction", () => {
    const list = [
      makeChannel("frozen", { isFrozen: true, lastUpdated: 9 }),
      makeChannel("other", { lastUpdated: 8 }),
      makeChannel("picked", { lastUpdated: 1 }),
    ]
    const selected = new Set(["picked", "frozen"])
    expect(sortNames(list, "last_updated", "desc", selected)).toEqual([
      "picked",
      "other",
      "frozen",
    ])
  })
})
