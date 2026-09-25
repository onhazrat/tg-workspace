import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { channelWritePayload, dataApi } from "./data"

describe("channelWritePayload", () => {
  it("strips inherited setting-group fields from channel PUT payloads", () => {
    const payload = channelWritePayload({
      id: "ch-a",
      name: "ch-a",
      tags: ["news"],
      autoFollowForwarded: true,
      autoSyncIntervalMinutes: 90,
      settingGroupId: "group-1",
      settingGroupName: "default",
      telegramChatId: -1001234567890,
      language: "fa",
      displayName: "Channel A",
    })

    expect(payload).toEqual({
      id: "ch-a",
      name: "ch-a",
      tags: ["news"],
      displayName: "Channel A",
    })
  })
})

/**
 * What the hand-written calls put on the wire.
 *
 * Each builds its request from optional params, and the recurring rule is
 * "omit when unset, but keep a real zero": `offset: 0` is the first page and
 * `olderThanDays: 0` is "everything", so a truthiness check would change what
 * the server does. The `fetch` stub answers only `/api/v1/data/`, so another
 * file's request still reaches the real `fetch`.
 */
type Sent = { url: string; method: string; body: unknown }
let sent: Sent[] = []
const realFetch = globalThis.fetch

beforeEach(() => {
  sent = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.startsWith("/api/v1/data/")) return realFetch(input, init)
    sent.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return new Response("[]")
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("getPostsFeed", () => {
  it("sends the cap mode and seed alongside a cap, with paging and sort", async () => {
    await dataApi.getPostsFeed({
      channelNames: ["alpha"],
      maxPerChannel: 5,
      maxPerChannelMode: "random",
      seed: 0,
      sort: "channel_time",
      limit: 50,
      offset: 0,
    })
    expect(sent).toEqual([
      {
        url: "/api/v1/data/posts",
        method: "POST",
        body: {
          channelNames: ["alpha"],
          maxPerChannel: 5,
          maxPerChannelMode: "random",
          seed: 0,
          sort: "channel_time",
          limit: 50,
          offset: 0,
        },
      },
    ])
  })

  it("drops the cap mode and seed when there is no cap", async () => {
    await dataApi.getPostsFeed({ maxPerChannelMode: "random", seed: 7 })
    await dataApi.getPostsFeed({
      maxPerChannel: 0,
      maxPerChannelMode: "random",
      seed: 7,
    })
    expect(sent.map((s) => s.body)).toEqual([{}, {}])
  })
})

describe("getDiscoverCandidates", () => {
  it("always sends channelNames, even empty, and nothing unset", async () => {
    await dataApi.getDiscoverCandidates({})
    expect(sent).toEqual([
      {
        url: "/api/v1/data/discover/candidates",
        method: "POST",
        body: { channelNames: [] },
      },
    ])
  })

  it("sends every scope field, keeping a zero seed and an empty postIds", async () => {
    await dataApi.getDiscoverCandidates({
      channelNames: ["alpha"],
      signals: ["mentions"],
      maxPerChannelMode: "latest",
      seed: 0,
      postIds: [],
    })
    expect(sent[0].body).toEqual({
      channelNames: ["alpha"],
      signals: ["mentions"],
      maxPerChannelMode: "latest",
      seed: 0,
      postIds: [],
    })
  })
})

describe("listArtifacts", () => {
  it("requests the bare path with no params", async () => {
    await dataApi.listArtifacts()
    await dataApi.listArtifacts({ starred: false })
    expect(sent.map((s) => s.url)).toEqual([
      "/api/v1/data/artifacts",
      "/api/v1/data/artifacts",
    ])
  })

  it("puts every set filter in the query string, keeping a zero offset", async () => {
    await dataApi.listArtifacts({
      kind: "chat",
      search: "iran",
      starred: true,
      limit: 20,
      offset: 0,
    })
    expect(sent[0].url).toBe(
      "/api/v1/data/artifacts?kind=chat&search=iran&starred=true&limit=20&offset=0",
    )
  })
})

describe("deleteLogs", () => {
  it("sends a DELETE with every set filter, keeping zero days", async () => {
    await dataApi.deleteLogs({
      olderThanDays: 0,
      type: "sync",
      logId: "log-1",
      clearAll: true,
    })
    expect(sent).toEqual([
      {
        url: "/api/v1/data/logs?olderThanDays=0&type=sync&logId=log-1&clearAll=true",
        method: "DELETE",
        body: undefined,
      },
    ])
  })

  it("sends the bare path when nothing is set", async () => {
    await dataApi.deleteLogs({ clearAll: false })
    expect(sent[0].url).toBe("/api/v1/data/logs")
  })
})

describe("getPosts", () => {
  it("sends an empty body when nothing is set, dropping an empty selection", async () => {
    await dataApi.getPosts()
    await dataApi.getPosts({ channelNames: [] })
    expect(sent.map((s) => s.body)).toEqual([{}, {}])
  })

  it("sends the selection, a window for the dates, and a zero offset", async () => {
    await dataApi.getPosts({
      channelNames: ["alpha"],
      startDate: 60_000,
      endDate: 120_000,
      limit: 10,
      offset: 0,
    })
    expect(sent[0]).toMatchObject({
      url: "/api/v1/data/posts",
      method: "POST",
      body: {
        channelNames: ["alpha"],
        window: expect.any(Object),
        limit: 10,
        offset: 0,
      },
    })
  })
})

/**
 * The three paged list reads share one rule: an empty `search` is omitted,
 * `limit` and `offset` survive a zero, and the bare path carries no `?`.
 */
describe.each([
  ["listDiscoverReports", "/api/v1/data/discover/reports"],
  ["listSummaries", "/api/v1/data/summaries"],
  ["listChatSessions", "/api/v1/data/chat-sessions"],
] as const)("%s", (name, path) => {
  it("requests the bare path when nothing is set", async () => {
    await dataApi[name]()
    await dataApi[name]({ search: "" })
    expect(sent.map((s) => s.url)).toEqual([path, path])
  })

  it("puts search, limit and a zero offset in the query string", async () => {
    await dataApi[name]({ search: "iran war", limit: 20, offset: 0 })
    const [base, query] = sent[0].url.split("?")
    expect(base).toBe(path)
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      search: "iran war",
      limit: "20",
      offset: "0",
    })
  })
})
