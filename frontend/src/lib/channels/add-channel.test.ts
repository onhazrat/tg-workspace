import { describe, expect, test } from "bun:test"

import {
  addChannelByName,
  findChannelByTelegramChatId,
  normalizeChannelHandle,
} from "@/lib/channels/add-channel"
import {
  filterPostsByTextQuery,
  filterSummariesByTextQuery,
  SEARCH_RESULTS_CAP,
} from "@/lib/commands/search-filters"
import type { CommandContext } from "@/lib/commands/types"
import { getEntityCandidates } from "@/lib/commands/useChannelEntityFlow"
import type { Channel, Post, Summary } from "@/types"

const sampleChannels: Channel[] = [
  { id: "1", name: "alpha", isFrozen: true },
  { id: "2", name: "beta", isUnavailableOnWebView: true },
  { id: "3", name: "gamma" },
]

const samplePosts: Post[] = [
  {
    id: 1,
    channelName: "alpha",
    text: "Bitcoin rally continues",
    date: "2024-01-01",
    timestamp: 1,
  },
  {
    id: 2,
    channelName: "beta",
    text: "Local weather update",
    date: "2024-01-02",
    timestamp: 2,
  },
]

const sampleSummaries: Summary[] = [
  {
    id: "s1",
    text: "Weekly crypto digest",
    channels: ["alpha"],
    startDate: 1,
    endDate: 2,
    language: "en",
    model: "gemini",
    timestamp: 1,
    promptText: "Summarize crypto",
    note: "starred run",
  },
  {
    id: "s2",
    text: "Tech headlines",
    channels: ["beta"],
    startDate: 1,
    endDate: 2,
    language: "en",
    timestamp: 2,
  },
]

describe("normalizeChannelHandle", () => {
  test("strips @ and path segments", () => {
    expect(normalizeChannelHandle("@foo/bar")).toBe("bar")
    expect(normalizeChannelHandle("  @channel  ")).toBe("channel")
  })
})

describe("addChannelByName duplicate", () => {
  test("returns early when channel already exists", async () => {
    const result = await addChannelByName("alpha", {
      channels: sampleChannels,
      setSelectedChannels: () => {},
      loadChannels: async () => {},
      addToSyncQueue: () => {},
      loadNetworkLogs: async () => {},
      getEffectiveGlobalStartTime: () => 0,
      settings: {
        proxyEnabled: false,
        defaultProxyUrls: "",
        torEnabled: false,
        torMode: "auto",
        torProxyUrls: "",
        torAutoRotate: false,
        torRotationThreshold: 0,
      },
    })

    expect(result.ok).toBe(false)
  })
})

describe("findChannelByTelegramChatId", () => {
  test("returns existing channel with matching telegram chat id", () => {
    const channels: Channel[] = [
      { id: "1", name: "alpha", telegramChatId: -10011 },
      { id: "2", name: "beta", telegramChatId: -10022 },
    ]
    const existing = findChannelByTelegramChatId(channels, -10022)
    expect(existing?.name).toBe("beta")
  })

  test("returns undefined when no channel matches", () => {
    const channels: Channel[] = [
      { id: "1", name: "alpha", telegramChatId: -10011 },
    ]
    expect(findChannelByTelegramChatId(channels, -10099)).toBeUndefined()
  })
})

describe("getEntityCandidates channel ops pools", () => {
  const ctx = {
    channels: sampleChannels,
    selectedChannels: new Set<string>(),
  } as CommandContext

  test("sync-channel includes frozen channels", () => {
    const candidates = getEntityCandidates("sync-channel", ctx)
    expect(candidates.some((channel) => channel.isFrozen)).toBe(true)
    expect(candidates).toHaveLength(3)
  })

  test("delete-channel includes frozen and unavailable channels", () => {
    const candidates = getEntityCandidates("delete-channel", ctx)
    expect(candidates.some((channel) => channel.isFrozen)).toBe(true)
    expect(candidates.some((channel) => channel.isUnavailableOnWebView)).toBe(
      true,
    )
    expect(candidates).toHaveLength(3)
  })
})

describe("search filter helpers", () => {
  test("filterPostsByTextQuery matches channel and text", () => {
    const filtered = filterPostsByTextQuery(samplePosts, "bitcoin")
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.channelName).toBe("alpha")

    const byChannel = filterPostsByTextQuery(samplePosts, "beta")
    expect(byChannel).toHaveLength(1)
  })

  test("empty post query returns all posts", () => {
    expect(filterPostsByTextQuery(samplePosts, "")).toHaveLength(2)
  })

  test("filterSummariesByTextQuery matches history fields", () => {
    expect(filterSummariesByTextQuery(sampleSummaries, "crypto")).toHaveLength(
      1,
    )
    expect(filterSummariesByTextQuery(sampleSummaries, "gemini")).toHaveLength(
      1,
    )
    expect(filterSummariesByTextQuery(sampleSummaries, "starred")).toHaveLength(
      1,
    )
  })

  test("empty summary query returns all summaries", () => {
    expect(filterSummariesByTextQuery(sampleSummaries, "")).toHaveLength(2)
  })

  test("search results cap constant", () => {
    expect(SEARCH_RESULTS_CAP).toBe(50)
  })
})
