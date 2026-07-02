import { describe, expect, it } from "bun:test"

import {
  collectAllChannelTags,
  filterChannelsByTag,
  sortTagsForChannelGrid,
} from "@/lib/channels/channel-tags"
import type { Channel } from "@/types"

const sampleChannels: Channel[] = [
  {
    id: "news",
    name: "news",
    tags: [{ name: "Tech", source: "manual", assignedAt: 1 }, "daily"],
    lastUpdated: 0,
    followedAt: 0,
  },
  {
    id: "sports",
    name: "sports",
    tags: ["tech"],
    lastUpdated: 0,
    followedAt: 0,
  },
  {
    id: "empty",
    name: "empty",
    tags: [],
    lastUpdated: 0,
    followedAt: 0,
  },
]

describe("filterChannelsByTag", () => {
  it("matches tags case-insensitively", () => {
    const matches = filterChannelsByTag(sampleChannels, "TECH")
    expect(matches.map((channel) => channel.name).sort()).toEqual([
      "news",
      "sports",
    ])
  })

  it("returns empty for unknown tag", () => {
    expect(filterChannelsByTag(sampleChannels, "missing")).toEqual([])
  })
})

describe("collectAllChannelTags", () => {
  it("returns sorted unique tags", () => {
    expect(collectAllChannelTags(sampleChannels)).toEqual([
      "daily",
      "tech",
      "Tech",
    ])
  })
})

describe("sortTagsForChannelGrid", () => {
  const gridChannels: Channel[] = [
    {
      id: "a",
      name: "a",
      tags: ["alpha", "shared"],
      lastUpdated: 0,
      followedAt: 0,
    },
    {
      id: "b",
      name: "b",
      tags: ["beta", "shared"],
      lastUpdated: 0,
      followedAt: 0,
    },
    {
      id: "c",
      name: "c",
      tags: ["beta"],
      lastUpdated: 0,
      followedAt: 0,
    },
    {
      id: "d",
      name: "d",
      tags: ["gamma"],
      lastUpdated: 0,
      followedAt: 0,
    },
  ]

  it("groups fully selected, then partial, then none; sorts by channel count within group", () => {
    const tags = ["alpha", "beta", "gamma", "shared"]
    const selected = new Set(["a", "b"])

    expect(
      sortTagsForChannelGrid(tags, gridChannels, selected),
    ).toEqual(["shared", "alpha", "beta", "gamma"])
  })

  it("uses selected count as tiebreaker within the same group", () => {
    const channels: Channel[] = [
      {
        id: "1",
        name: "1",
        tags: ["tie-a"],
        lastUpdated: 0,
        followedAt: 0,
      },
      {
        id: "2",
        name: "2",
        tags: ["tie-a", "tie-b"],
        lastUpdated: 0,
        followedAt: 0,
      },
      {
        id: "3",
        name: "3",
        tags: ["tie-a", "tie-b"],
        lastUpdated: 0,
        followedAt: 0,
      },
      {
        id: "4",
        name: "4",
        tags: ["tie-b"],
        lastUpdated: 0,
        followedAt: 0,
      },
    ]
    const tags = ["tie-a", "tie-b"]
    const selected = new Set(["1", "2", "4"])

    expect(sortTagsForChannelGrid(tags, channels, selected)).toEqual([
      "tie-a",
      "tie-b",
    ])
  })
})
