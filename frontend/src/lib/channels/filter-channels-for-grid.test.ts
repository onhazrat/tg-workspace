import { describe, expect, it } from "bun:test"

import {
  collectChannelLanguages,
  filterChannelsForGrid,
} from "@/lib/channels/filter-channels-for-grid"
import type { Channel } from "@/types"

const sampleChannels: Channel[] = [
  {
    id: "news",
    name: "news",
    displayName: "Daily News",
    tags: ["Tech", "world"],
    language: "en",
    settingGroupId: "group-a",
    lastUpdated: 0,
    followedAt: 0,
  },
  {
    id: "sports",
    name: "sports",
    displayName: "Sports Hub",
    tags: [],
    language: "fa",
    settingGroupId: "group-b",
    lastUpdated: 0,
    followedAt: 0,
  },
  {
    id: "quiet",
    name: "quiet",
    tags: [{ name: "tech-news", source: "manual", assignedAt: 1 }],
    lastUpdated: 0,
    followedAt: 0,
  },
]

const noFilters = { groupFilter: "", languageFilter: "", search: "" }

describe("filterChannelsForGrid", () => {
  it("returns all channels when no filters are active", () => {
    expect(filterChannelsForGrid(sampleChannels, noFilters)).toEqual(
      sampleChannels,
    )
  })

  it("filters by setting group id", () => {
    expect(
      filterChannelsForGrid(sampleChannels, {
        ...noFilters,
        groupFilter: "group-a",
      }).map((c) => c.name),
    ).toEqual(["news"])
  })

  it("filters by language", () => {
    expect(
      filterChannelsForGrid(sampleChannels, {
        ...noFilters,
        languageFilter: "fa",
      }).map((c) => c.name),
    ).toEqual(["sports"])
  })

  it("matches search against name, display name, and tags case-insensitively", () => {
    expect(
      filterChannelsForGrid(sampleChannels, {
        ...noFilters,
        search: "SPORT",
      }).map((c) => c.name),
    ).toEqual(["sports"])
    expect(
      filterChannelsForGrid(sampleChannels, {
        ...noFilters,
        search: "daily",
      }).map((c) => c.name),
    ).toEqual(["news"])
    expect(
      filterChannelsForGrid(sampleChannels, {
        ...noFilters,
        search: "tech",
      }).map((c) => c.name),
    ).toEqual(["news", "quiet"])
  })

  it("ignores whitespace-only search", () => {
    expect(
      filterChannelsForGrid(sampleChannels, { ...noFilters, search: "   " }),
    ).toEqual(sampleChannels)
  })

  it("does not trim the search query when matching", () => {
    // " news" matches "Daily News" (embedded space) but " sports" matches nothing
    expect(
      filterChannelsForGrid(sampleChannels, {
        ...noFilters,
        search: " news",
      }).map((c) => c.name),
    ).toEqual(["news"])
    expect(
      filterChannelsForGrid(sampleChannels, {
        ...noFilters,
        search: " sports",
      }),
    ).toEqual([])
  })

  it("combines group, language, and search filters", () => {
    expect(
      filterChannelsForGrid(sampleChannels, {
        groupFilter: "group-a",
        languageFilter: "en",
        search: "news",
      }).map((c) => c.name),
    ).toEqual(["news"])
    expect(
      filterChannelsForGrid(sampleChannels, {
        groupFilter: "group-b",
        languageFilter: "en",
        search: "",
      }),
    ).toEqual([])
  })
})

describe("collectChannelLanguages", () => {
  it("returns sorted unique languages, skipping channels without one", () => {
    const channels: Channel[] = [
      ...sampleChannels,
      {
        id: "dup",
        name: "dup",
        tags: [],
        language: "en",
        lastUpdated: 0,
        followedAt: 0,
      },
    ]
    expect(collectChannelLanguages(channels)).toEqual(["en", "fa"])
  })

  it("returns empty for channels without languages", () => {
    expect(collectChannelLanguages([sampleChannels[2]])).toEqual([])
  })
})
