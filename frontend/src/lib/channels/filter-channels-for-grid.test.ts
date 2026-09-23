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
  const withLanguage = (name: string, language: string): Channel => ({
    id: name,
    name,
    tags: [],
    language,
    lastUpdated: 0,
    followedAt: 0,
  })

  it("lists each code once, named, sorted by name, skipping channels without one", () => {
    const channels = [...sampleChannels, withLanguage("dup", "en")]
    expect(collectChannelLanguages(channels, "en")).toEqual([
      { code: "en", name: "English" },
      { code: "fa", name: "Persian" },
    ])
  })

  it("sorts by the displayed name, not the code", () => {
    // `en` sorts before `hy` as a code; "Armenian" before "English" as a name.
    const channels = [withLanguage("a", "en"), withLanguage("b", "hy")]
    expect(collectChannelLanguages(channels, "en").map((l) => l.code)).toEqual([
      "hy",
      "en",
    ])
  })

  it("names languages in the locale it is given", () => {
    expect(collectChannelLanguages([withLanguage("a", "fa")], "de")).toEqual([
      { code: "fa", name: "Persisch" },
    ])
  })

  it("returns empty for channels without languages", () => {
    expect(collectChannelLanguages([sampleChannels[2]])).toEqual([])
  })
})
