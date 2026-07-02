import { describe, expect, test } from "bun:test"
import type { Channel } from "@/types"
import {
  channelMatchesSearch,
  filterChannelsByQuery,
  filterPartialHistoryChannels,
  parseChannelSearchQuery,
} from "./filter-channels"

const sampleChannels: Channel[] = [
  {
    id: "1",
    name: "cryptonews",
    displayName: "Crypto News Daily",
    tags: [{ name: "crypto", source: "manual", assignedAt: 1 }, "finance"],
  },
  {
    id: "2",
    name: "techdigest",
    displayName: "Tech Digest",
    tags: ["tech"],
  },
  {
    id: "3",
    name: "untagged",
    tags: [],
  },
]

describe("parseChannelSearchQuery", () => {
  test("empty query searches all fields", () => {
    expect(parseChannelSearchQuery("")).toEqual({ mode: "all", term: "" })
    expect(parseChannelSearchQuery("  ")).toEqual({ mode: "all", term: "" })
  })

  test("tag: prefix enables tag-only mode", () => {
    expect(parseChannelSearchQuery("tag:crypto")).toEqual({
      mode: "tag-only",
      term: "crypto",
    })
    expect(parseChannelSearchQuery("TAG: Crypto")).toEqual({
      mode: "tag-only",
      term: "crypto",
    })
  })

  test("# prefix enables tag-only mode", () => {
    expect(parseChannelSearchQuery("#tech")).toEqual({
      mode: "tag-only",
      term: "tech",
    })
    expect(parseChannelSearchQuery("# finance")).toEqual({
      mode: "tag-only",
      term: "finance",
    })
  })

  test("plain query uses all-field mode", () => {
    expect(parseChannelSearchQuery("digest")).toEqual({
      mode: "all",
      term: "digest",
    })
  })
})

describe("filterChannelsByQuery", () => {
  test("matches name, displayName, and tags in all mode", () => {
    expect(
      filterChannelsByQuery(sampleChannels, "crypto").map((c) => c.name),
    ).toEqual(["cryptonews"])
    expect(
      filterChannelsByQuery(sampleChannels, "digest").map((c) => c.name),
    ).toEqual(["techdigest"])
    expect(
      filterChannelsByQuery(sampleChannels, "finance").map((c) => c.name),
    ).toEqual(["cryptonews"])
  })

  test("tag-only prefix excludes name/displayName matches", () => {
    expect(
      filterChannelsByQuery(sampleChannels, "tag:digest").map((c) => c.name),
    ).toEqual([])
    expect(
      filterChannelsByQuery(sampleChannels, "#tech").map((c) => c.name),
    ).toEqual(["techdigest"])
  })

  test("tag-only prefix matches tag substrings case-insensitively", () => {
    expect(
      filterChannelsByQuery(sampleChannels, "tag:CRYPTO").map((c) => c.name),
    ).toEqual(["cryptonews"])
  })

  test("channels without tags never match tag-only search", () => {
    expect(
      channelMatchesSearch(sampleChannels[2], "tag-only", "anything"),
    ).toBe(false)
  })
})

describe("filterPartialHistoryChannels", () => {
  test("returns only channels with historyCompleteToCutoff === false", () => {
    const channels: Channel[] = [
      { id: "1", name: "complete", historyCompleteToCutoff: true },
      { id: "2", name: "partial", historyCompleteToCutoff: false },
      { id: "3", name: "unknown" },
      { id: "4", name: "also-partial", historyCompleteToCutoff: false },
    ]
    expect(filterPartialHistoryChannels(channels).map((c) => c.name)).toEqual([
      "partial",
      "also-partial",
    ])
  })
})
