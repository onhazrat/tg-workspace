import { describe, expect, it } from "bun:test"

import type { Channel, ChannelStats, Post } from "@/types"

import {
  buildPostsInScopeCounts,
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
