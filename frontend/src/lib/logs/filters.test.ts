import { describe, expect, test } from "bun:test"

import {
  DEFAULT_LOG_FILTERS,
  filterEmbeddingLogs,
  filterLlmLogs,
  filterNetworkLogs,
  filterPublishLogs,
  filterSyncLogs,
  isAnyLogFilterActive,
  jsonIncludes,
  matchesStatus,
  uniqueSorted,
} from "@/lib/logs/filters"
import type {
  EmbeddingLog,
  LLMLog,
  NetworkLog,
  PublishLog,
  SyncLog,
} from "@/types"

const filters = (overrides: Partial<typeof DEFAULT_LOG_FILTERS> = {}) => ({
  ...DEFAULT_LOG_FILTERS,
  ...overrides,
})

const publishLog = (overrides: Partial<PublishLog> = {}): PublishLog => ({
  id: "p1",
  summaryId: "s1",
  botId: "b1",
  botName: "NewsBot",
  chatId: "-100200",
  chatName: "Daily Digest",
  status: "success",
  timestamp: 1_000,
  ...overrides,
})

const syncLog = (overrides: Partial<SyncLog> = {}): SyncLog => ({
  id: "s1",
  channelName: "technews",
  status: "success",
  postsCount: 3,
  timestamp: 1_000,
  source: "web",
  ...overrides,
})

const llmLog = (overrides: Partial<LLMLog> = {}): LLMLog => ({
  id: "l1",
  model: "gemini-pro",
  prompt: "Summarize this",
  response: "A short summary",
  status: "success",
  timestamp: 1_000,
  type: "summary",
  ...overrides,
})

const networkLog = (overrides: Partial<NetworkLog> = {}): NetworkLog => ({
  id: "n1",
  url: "https://telegram.me/s/technews",
  method: "GET",
  status: "success",
  duration: 120,
  timestamp: 1_000,
  source: "sync",
  ...overrides,
})

const embeddingLog = (overrides: Partial<EmbeddingLog> = {}): EmbeddingLog => ({
  id: "e1",
  textCount: 42,
  duration: 90,
  status: "success",
  timestamp: 1_000,
  ...overrides,
})

describe("matchesStatus", () => {
  test("'all' matches every status", () => {
    expect(matchesStatus("success", "all")).toBe(true)
    expect(matchesStatus("failed", "all")).toBe(true)
  })

  test("specific filter only matches its own status", () => {
    expect(matchesStatus("success", "success")).toBe(true)
    expect(matchesStatus("failed", "success")).toBe(false)
    expect(matchesStatus("failed", "failed")).toBe(true)
  })
})

describe("jsonIncludes", () => {
  test("missing values never match", () => {
    expect(jsonIncludes(undefined, "x")).toBe(false)
    expect(jsonIncludes(null, "x")).toBe(false)
  })

  test("matches nested values case-insensitively", () => {
    expect(jsonIncludes({ outer: { detail: "Rate LIMITED" } }, "limited")).toBe(
      true,
    )
    expect(jsonIncludes({ outer: "nothing" }, "limited")).toBe(false)
  })
})

describe("filterPublishLogs", () => {
  const logs = [
    publishLog({ id: "a", status: "success", botName: "NewsBot" }),
    publishLog({
      id: "b",
      status: "failed",
      botName: "AltBot",
      error: "chat not found",
    }),
  ]

  test("filters by status", () => {
    expect(
      filterPublishLogs(logs, filters({ statusFilter: "failed" })).map(
        (l) => l.id,
      ),
    ).toEqual(["b"])
  })

  test("filters by bot name", () => {
    expect(
      filterPublishLogs(logs, filters({ botFilter: "NewsBot" })).map(
        (l) => l.id,
      ),
    ).toEqual(["a"])
  })

  test("a Logged bound is the server's job, not the browser's (TB-05)", () => {
    // The server bounds the whole log before paging; bounding the page here
    // again would only repeat it, and a Live bound would disagree with the
    // server's minute.
    const dated = [
      publishLog({ id: "old", timestamp: 1_000 }),
      publishLog({ id: "new", timestamp: 864_000_000 }),
    ]
    expect(
      filterPublishLogs(
        dated,
        filters({ timeBound: { mode: "fixed", start: 86_400_000 } }),
      ).map((l) => l.id),
    ).toEqual(["old", "new"])
  })

  test("the text query is the server's job and must not be applied here", () => {
    // The server matches `fields OR bodies` and the list no longer carries the
    // bodies. A second pass over fields here would drop exactly the rows that
    // matched only on a body — the ones "search in details" exists for.
    expect(
      filterPublishLogs(logs, filters({ searchQuery: "zzz-matches-nothing" })),
    ).toEqual(logs)
    expect(
      filterPublishLogs(
        logs,
        filters({ searchQuery: "zzz", searchInDetails: true }),
      ),
    ).toEqual(logs)
  })
})

describe("filterSyncLogs", () => {
  const logs = [
    syncLog({ id: "a", channelName: "technews", source: "web" }),
    syncLog({ id: "b", channelName: "cryptonews", source: "rss" }),
  ]

  test("filters by channel", () => {
    expect(
      filterSyncLogs(logs, filters({ channelFilter: "cryptonews" })).map(
        (l) => l.id,
      ),
    ).toEqual(["b"])
  })

  test("the text query is not applied here — see filterPublishLogs", () => {
    expect(
      filterSyncLogs(logs, filters({ searchQuery: "zzz-matches-nothing" })),
    ).toEqual(logs)
  })
})

describe("filterLlmLogs", () => {
  const logs = [
    llmLog({ id: "a", model: "gemini-pro", prompt: "translate greeting" }),
    llmLog({ id: "b", model: "gpt-4o", response: "bonjour" }),
  ]

  test("filters by model", () => {
    expect(
      filterLlmLogs(logs, filters({ modelFilter: "gpt-4o" })).map((l) => l.id),
    ).toEqual(["b"])
  })

  test("the text query is not applied here — see filterPublishLogs", () => {
    expect(
      filterLlmLogs(logs, filters({ searchQuery: "zzz-matches-nothing" })),
    ).toEqual(logs)
  })
})

describe("filterNetworkLogs", () => {
  const logs = [
    networkLog({ id: "a", method: "GET" }),
    networkLog({
      id: "b",
      method: "POST",
      telemetry: { exitNode: "de-berlin" },
    }),
  ]

  test("the text query is not applied here — see filterPublishLogs", () => {
    expect(
      filterNetworkLogs(logs, filters({ searchQuery: "zzz-matches-nothing" })),
    ).toEqual(logs)
  })
})

describe("filterEmbeddingLogs", () => {
  const logs = [
    embeddingLog({ id: "a", textCount: 42 }),
    embeddingLog({ id: "b", textCount: 7, error: "quota exceeded" }),
  ]

  test("the text query is not applied here — see filterPublishLogs", () => {
    expect(
      filterEmbeddingLogs(
        logs,
        filters({ searchQuery: "zzz-matches-nothing" }),
      ),
    ).toEqual(logs)
  })

  test("filters by status and date like other tabs", () => {
    const mixed = [
      embeddingLog({ id: "ok", status: "success" }),
      embeddingLog({ id: "bad", status: "failed" }),
    ]
    expect(
      filterEmbeddingLogs(mixed, filters({ statusFilter: "failed" })).map(
        (l) => l.id,
      ),
    ).toEqual(["bad"])
  })
})

describe("uniqueSorted", () => {
  test("dedupes and sorts", () => {
    expect(uniqueSorted(["b", "a", "b", "c", "a"])).toEqual(["a", "b", "c"])
    expect(uniqueSorted([])).toEqual([])
  })
})

describe("isAnyLogFilterActive", () => {
  test("defaults are inactive", () => {
    expect(isAnyLogFilterActive(filters())).toBe(false)
  })

  test("a Logged bound with both ends open is Any time, so inactive", () => {
    expect(
      isAnyLogFilterActive(filters({ timeBound: { mode: "fixed" } })),
    ).toBe(false)
  })

  test("each field activates the filter state", () => {
    expect(isAnyLogFilterActive(filters({ searchQuery: "x" }))).toBe(true)
    expect(isAnyLogFilterActive(filters({ statusFilter: "failed" }))).toBe(true)
    expect(
      isAnyLogFilterActive(filters({ timeBound: { mode: "live", start: -1 } })),
    ).toBe(true)
    expect(
      isAnyLogFilterActive(filters({ timeBound: { mode: "fixed", end: 1 } })),
    ).toBe(true)
    expect(isAnyLogFilterActive(filters({ modelFilter: "gpt" }))).toBe(true)
    expect(isAnyLogFilterActive(filters({ botFilter: "bot" }))).toBe(true)
    expect(isAnyLogFilterActive(filters({ channelFilter: "ch" }))).toBe(true)
    expect(isAnyLogFilterActive(filters({ searchInDetails: true }))).toBe(true)
  })
})
