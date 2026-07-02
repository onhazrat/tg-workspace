import { describe, expect, it } from "bun:test"

import type { Channel } from "@/types"

import {
  applyTagSuggestions,
  buildBulkChannelTagUpdates,
  buildChannelLookup,
  filterSuggestionsToSelectedChannels,
  normalizeParsedTagSuggestions,
  resolveChannelForTagKey,
} from "./apply-tag-suggestions"

function makeChannel(name: string, tags: Channel["tags"] = []): Channel {
  return {
    id: name,
    name,
    tags,
  }
}

describe("normalizeParsedTagSuggestions", () => {
  it("maps @-prefixed and display names to canonical channel names", () => {
    const channels = [
      makeChannel("alpha", []),
      { ...makeChannel("beta", []), displayName: "Beta News" },
    ]
    const normalized = normalizeParsedTagSuggestions(
      {
        "@alpha": ["Politics"],
        "Beta News": ["Sports"],
      },
      channels,
    )
    expect(normalized).toEqual({
      alpha: ["Politics"],
      beta: ["Sports"],
    })
  })
})

describe("filterSuggestionsToSelectedChannels", () => {
  it("keeps only suggestions for currently selected channels", () => {
    const filtered = filterSuggestionsToSelectedChannels(
      { alpha: ["Politics"], beta: ["Sports"], gamma: ["Tech"] },
      ["alpha", "gamma"],
    )
    expect(filtered).toEqual({
      alpha: ["Politics"],
      gamma: ["Tech"],
    })
  })
})

describe("applyTagSuggestions", () => {
  it("applies all matched channels in the response, not a batch slice", () => {
    const channels = Array.from({ length: 15 }, (_, index) =>
      makeChannel(`chan${index}`, []),
    )
    const suggestions = Object.fromEntries(
      channels.map((channel) => [channel.name, ["Politics"]]),
    )

    const { result, updatedChannels } = applyTagSuggestions({
      suggestions,
      channels,
      mode: "add",
      selectedChannelNames: channels.map((channel) => channel.name),
    })

    expect(result.channelsUpdated).toBe(15)
    expect(result.tagsAdded).toBe(15)
    expect(updatedChannels).toHaveLength(15)
  })

  it("skips channels outside the current selection", () => {
    const channels = [
      makeChannel("alpha", []),
      makeChannel("beta", []),
      makeChannel("gamma", []),
    ]

    const { result, updatedChannels } = applyTagSuggestions({
      suggestions: {
        alpha: ["Politics"],
        beta: ["Sports"],
        gamma: ["Tech"],
      },
      channels,
      mode: "add",
      selectedChannelNames: ["alpha", "beta"],
    })

    expect(result.channelsUpdated).toBe(2)
    expect(updatedChannels.map((channel) => channel.name)).toEqual([
      "alpha",
      "beta",
    ])
  })
})

describe("buildBulkChannelTagUpdates", () => {
  it("maps updated channels to bulk API payload", () => {
    const channels = [
      makeChannel("alpha", [
        { name: "Politics", source: "ai", assignedAt: 123 },
      ]),
      makeChannel("beta", []),
    ]
    expect(buildBulkChannelTagUpdates(channels)).toEqual([
      {
        channelId: "alpha",
        tags: [{ name: "Politics", source: "ai", assignedAt: 123 }],
      },
      { channelId: "beta", tags: [] },
    ])
  })
})

describe("resolveChannelForTagKey", () => {
  it("resolves channels case-insensitively", () => {
    const lookup = buildChannelLookup([makeChannel("AlphaChannel")])
    expect(resolveChannelForTagKey(lookup, "alphachannel")?.name).toBe(
      "AlphaChannel",
    )
  })
})
