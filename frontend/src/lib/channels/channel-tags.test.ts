import { describe, expect, it } from "bun:test"

import {
  collectAllChannelTags,
  filterChannelsByTag,
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
