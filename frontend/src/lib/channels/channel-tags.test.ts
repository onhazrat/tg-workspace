import { describe, expect, it } from "bun:test"

import {
  buildChannelPseudoTagChips,
  collectAllChannelTags,
  filterChannelsByTag,
  filterTagsBySearch,
  filterUntaggedChannels,
  findChannelPseudoTag,
  isUiPseudoTag,
  isUntaggedChannel,
  PARTIAL_HISTORY_TAG_ID,
  sortTagsForChannelGrid,
  UNTAGGED_TAG_ID,
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

describe("filterUntaggedChannels", () => {
  it("returns channels with no tags", () => {
    expect(filterUntaggedChannels(sampleChannels).map((c) => c.name)).toEqual([
      "empty",
    ])
  })

  it("isUntaggedChannel is true only when tag list is empty", () => {
    expect(isUntaggedChannel(sampleChannels[0])).toBe(false)
    expect(isUntaggedChannel(sampleChannels[2])).toBe(true)
  })
})

describe("filterChannelsByTag", () => {
  it("matches UI untagged pseudo-tag", () => {
    expect(
      filterChannelsByTag(sampleChannels, UNTAGGED_TAG_ID).map((c) => c.name),
    ).toEqual(["empty"])
  })

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

describe("partial history pseudo-tag", () => {
  const historyChannels: Channel[] = [
    {
      id: "complete",
      name: "complete",
      tags: ["tech"],
      lastUpdated: 0,
      followedAt: 0,
      historyCompleteToCutoff: true,
    },
    {
      id: "partial",
      name: "partial",
      tags: ["tech"],
      lastUpdated: 0,
      followedAt: 0,
      historyCompleteToCutoff: false,
    },
    {
      id: "unknown",
      name: "unknown",
      tags: [],
      lastUpdated: 0,
      followedAt: 0,
    },
  ]

  it("selects only channels flagged incomplete, not undetermined ones", () => {
    expect(
      filterChannelsByTag(historyChannels, PARTIAL_HISTORY_TAG_ID).map(
        (c) => c.name,
      ),
    ).toEqual(["partial"])
  })

  it("is recognised as a pseudo-tag, unlike a real tag name", () => {
    expect(isUiPseudoTag(PARTIAL_HISTORY_TAG_ID)).toBe(true)
    expect(isUiPseudoTag(UNTAGGED_TAG_ID)).toBe(true)
    expect(isUiPseudoTag("tech")).toBe(false)
    expect(findChannelPseudoTag(PARTIAL_HISTORY_TAG_ID)?.label).toBe(
      "Partial history",
    )
  })

  it("builds a chip per matching pseudo-tag, with its channel names", () => {
    const chips = buildChannelPseudoTagChips(historyChannels, "")
    expect(chips.map((chip) => chip.id)).toEqual([
      UNTAGGED_TAG_ID,
      PARTIAL_HISTORY_TAG_ID,
    ])
    expect(chips[1].channelNames).toEqual(["partial"])
    expect(chips[1].testId).toBe("channel-tag-partial-history")
  })

  it("hides chips that match no channel", () => {
    const allComplete = [historyChannels[0]]
    expect(buildChannelPseudoTagChips(allComplete, "")).toEqual([])
  })

  it("honours the tag search box", () => {
    expect(
      buildChannelPseudoTagChips(historyChannels, "partial").map(
        (chip) => chip.id,
      ),
    ).toEqual([PARTIAL_HISTORY_TAG_ID])
    expect(
      buildChannelPseudoTagChips(historyChannels, "untag").map(
        (chip) => chip.id,
      ),
    ).toEqual([UNTAGGED_TAG_ID])
    expect(buildChannelPseudoTagChips(historyChannels, "zzz")).toEqual([])
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

describe("filterTagsBySearch", () => {
  const tags = ["Tech", "daily", "politics", "tech-news"]

  it("returns all tags when query is empty", () => {
    expect(filterTagsBySearch(tags, "")).toEqual(tags)
    expect(filterTagsBySearch(tags, "   ")).toEqual(tags)
  })

  it("filters tags case-insensitively by substring", () => {
    expect(filterTagsBySearch(tags, "tech")).toEqual(["Tech", "tech-news"])
    expect(filterTagsBySearch(tags, "DAIL")).toEqual(["daily"])
  })

  it("returns empty when nothing matches", () => {
    expect(filterTagsBySearch(tags, "missing")).toEqual([])
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

    expect(sortTagsForChannelGrid(tags, gridChannels, selected)).toEqual([
      "shared",
      "alpha",
      "beta",
      "gamma",
    ])
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
