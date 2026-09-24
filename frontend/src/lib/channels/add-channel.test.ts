import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { toast } from "sonner"

import type { ChannelInfoResponse } from "@/client"
import {
  type AddChannelContext,
  addChannelByName,
  addForwardedChannel,
  type ForwardedChannelContext,
  findChannelByTelegramChatId,
  normalizeChannelHandle,
} from "@/lib/channels/add-channel"
import type { ChannelInfoDeps } from "@/lib/channels/channel-info"
import {
  filterPostsByTextQuery,
  SEARCH_RESULTS_CAP,
} from "@/lib/commands/search-filters"
import type { CommandContext } from "@/lib/commands/types"
import { getEntityCandidates } from "@/lib/commands/useChannelEntityFlow"
import { filterSummariesByTextQuery } from "@/lib/summary-projection"
import type { Channel, NetworkLog, Post, Summary } from "@/types"

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

const networkSettings = {
  proxyEnabled: true,
  defaultProxyUrls: "",
  torEnabled: false,
  torMode: "auto" as const,
  torProxyUrls: "",
  torAutoRotate: false,
  torRotationThreshold: 0,
}

/** A context and API fakes that record every call the add flows make. */
function addHarness(answer: ChannelInfoResponse | Error, channels: Channel[]) {
  const calls = {
    logs: [] as NetworkLog[],
    upserts: [] as Channel[],
    queued: [] as Array<[string, string]>,
    selected: new Set<string>(),
    loaded: 0,
  }
  const deps: ChannelInfoDeps = {
    channelInfo: async () => {
      if (answer instanceof Error) throw answer
      return answer
    },
    bulkAssignSettingGroup: async () => {
      throw new Error("not used by the add flows")
    },
    saveNetworkLog: async (log) => {
      calls.logs.push(log)
    },
    upsertChannel: async (channel) => {
      calls.upserts.push(channel)
    },
  }
  const ctx = {
    isOffline: false,
    channels,
    setSelectedChannels: (update: (prev: Set<string>) => Set<string>) => {
      calls.selected = update(calls.selected)
    },
    loadChannels: async () => {
      calls.loaded++
    },
    addToSyncQueue: (channel: Channel, source: string) => {
      calls.queued.push([channel.name, source])
    },
    getEffectiveGlobalStartTime: () => 1234,
    settings: networkSettings,
  } as AddChannelContext & ForwardedChannelContext
  return { calls, deps, ctx }
}

const spies: Array<{ mockRestore: () => void }> = []
function spyToast(method: "success" | "error" | "info" | "warning") {
  const s = spyOn(toast, method)
  spies.push(s)
  return s
}
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore()
})

const unavailable = new Error(
  JSON.stringify({ error: "gone", isUnavailableOnWebView: true }),
)

describe("addChannelByName", () => {
  test("an empty handle is refused before any fetch", async () => {
    const { calls, deps, ctx } = addHarness({ channelName: "x" }, [])
    const error = spyToast("error")
    expect(await addChannelByName(" @ ", ctx, deps)).toEqual({ ok: false })
    expect(error).toHaveBeenCalledWith("Enter a channel handle")
    expect(calls.logs).toEqual([])
  })

  test("follows the channel, selects it, queues its first sync and logs the fetch", async () => {
    const { calls, deps, ctx } = addHarness(
      {
        channelName: "news",
        displayName: "News",
        subscribers: 5,
        telegramChatId: -1005,
      },
      sampleChannels,
    )
    const success = spyToast("success")

    const result = await addChannelByName("@News", ctx, deps)

    expect(result).toEqual({ ok: true, channelName: "News" })
    expect(calls.upserts[0]).toMatchObject({
      id: "News",
      name: "News",
      displayName: "News",
      subscribers: 5,
      startTime: 1234,
      tags: [],
      isUnavailableOnWebView: false,
      telegramChatId: -1005,
    })
    expect(calls.loaded).toBe(1)
    expect([...calls.selected]).toEqual(["News"])
    expect(calls.queued).toEqual([["News", "Initial Sync"]])
    expect(calls.logs[0]).toMatchObject({
      source: "AddChannel",
      status: "success",
    })
    expect(success).toHaveBeenCalledWith("Added @News")
  })

  test("a chat id already followed under another handle selects that channel instead", async () => {
    const { calls, deps, ctx } = addHarness(
      { channelName: "renamed", telegramChatId: -10022 },
      [{ id: "2", name: "beta", telegramChatId: -10022 }],
    )
    const info = spyToast("info")

    const result = await addChannelByName("renamed", ctx, deps)

    expect(result).toEqual({ ok: true, channelName: "beta" })
    expect(calls.upserts).toEqual([])
    expect([...calls.selected]).toEqual(["beta"])
    expect(calls.logs).toHaveLength(1)
    expect(info).toHaveBeenCalledWith("Already following this channel as @beta")
  })

  test("a channel the web view refuses is added Unavailable and not synced", async () => {
    const { calls, deps, ctx } = addHarness(unavailable, [])
    const warning = spyToast("warning")
    spies.push(spyOn(console, "error").mockImplementation(() => {}))

    const result = await addChannelByName("hidden", ctx, deps)

    expect(result).toEqual({ ok: true, channelName: "hidden" })
    expect(calls.upserts[0]).toMatchObject({
      displayName: "hidden",
      isUnavailableOnWebView: true,
    })
    expect(calls.queued).toEqual([])
    expect(calls.logs[0]).toMatchObject({ status: "failed", error: "gone" })
    expect(warning).toHaveBeenCalledTimes(1)
  })
})

describe("addChannelByName on a page that answers Unavailable", () => {
  test("adds it Unavailable without queueing a sync", async () => {
    const { calls, deps, ctx } = addHarness(
      { channelName: "hidden", isUnavailableOnWebView: true },
      [],
    )
    const warning = spyToast("warning")

    await addChannelByName("hidden", ctx, deps)

    expect(calls.upserts[0]?.isUnavailableOnWebView).toBe(true)
    expect(calls.queued).toEqual([])
    expect(calls.logs[0]?.status).toBe("success")
    expect(warning).toHaveBeenCalledTimes(1)
  })
})

describe("addForwardedChannel", () => {
  const via = { channelName: "alpha", postId: 7, timestamp: 99 }

  test("does nothing while offline", async () => {
    const { calls, deps, ctx } = addHarness({ channelName: "x" }, [])
    const warning = spyToast("warning")
    await addForwardedChannel("news", via, { ...ctx, isOffline: true }, deps)
    expect(calls.upserts).toEqual([])
    expect(warning).toHaveBeenCalledTimes(1)
  })

  test("ignores an empty handle and one already followed", async () => {
    const { calls, deps, ctx } = addHarness(
      { channelName: "x" },
      sampleChannels,
    )
    const info = spyToast("info")
    await addForwardedChannel("  ", via, ctx, deps)
    await addForwardedChannel("t.me/ALPHA", via, ctx, deps)
    expect(calls.upserts).toEqual([])
    expect(info).toHaveBeenCalledWith(
      "Channel @ALPHA is already in your workspace",
    )
  })

  test("follows it with where it was found, queues a sync and files no log", async () => {
    const { calls, deps, ctx } = addHarness(
      { channelName: "news", displayName: "News", photoUrl: "p.jpg", bio: "b" },
      [],
    )
    spyToast("success")

    await addForwardedChannel("@news", via, ctx, deps)

    expect(calls.upserts[0]).toMatchObject({
      name: "news",
      displayName: "News",
      photoUrl: "p.jpg",
      startTime: 1234,
      isFrozen: false,
      regularSyncEnabled: true,
      dynamicSyncEnabled: false,
      autoFollowForwarded: false,
      discoveredVia: via,
    })
    expect(calls.upserts[0]?.bio).toBeUndefined()
    expect(calls.loaded).toBe(1)
    expect(calls.selected.size).toBe(0)
    expect(calls.queued).toEqual([["news", "Manual (Added from Forward)"]])
    expect(calls.logs).toEqual([])
  })

  test("an Unavailable channel is added frozen, without an error toast", async () => {
    const { calls, deps, ctx } = addHarness(unavailable, [])
    const error = spyToast("error")
    spyToast("warning")
    spies.push(spyOn(console, "error").mockImplementation(() => {}))

    await addForwardedChannel("hidden", via, ctx, deps)

    expect(calls.upserts[0]).toMatchObject({
      isFrozen: true,
      isUnavailableOnWebView: true,
      regularSyncEnabled: false,
    })
    expect(calls.queued).toEqual([])
    expect(error).not.toHaveBeenCalled()
  })

  test("any other failure is shown and the channel is still added", async () => {
    const { calls, deps, ctx } = addHarness(new Error("timeout"), [])
    const error = spyToast("error")
    spyToast("success")
    spies.push(spyOn(console, "error").mockImplementation(() => {}))

    await addForwardedChannel("slow", via, ctx, deps)

    expect(error).toHaveBeenCalledWith("timeout")
    expect(calls.upserts[0]).toMatchObject({
      displayName: "slow",
      isFrozen: false,
    })
    expect(calls.queued).toEqual([["slow", "Manual (Added from Forward)"]])
  })
})
