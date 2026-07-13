import { describe, expect, test } from "bun:test"

import {
  DAY_MS,
  DEFAULT_LOG_FILTERS,
  filterEmbeddingLogs,
  filterLlmLogs,
  filterNetworkLogs,
  filterPublishLogs,
  filterSyncLogs,
  isAnyLogFilterActive,
  jsonIncludes,
  matchesDateRange,
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
  url: "https://t.me/s/technews",
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

describe("matchesDateRange", () => {
  test("no bounds matches everything", () => {
    expect(matchesDateRange(0, null, null)).toBe(true)
  })

  test("start bound is inclusive", () => {
    expect(matchesDateRange(999, 1_000, null)).toBe(false)
    expect(matchesDateRange(1_000, 1_000, null)).toBe(true)
  })

  test("end bound includes the whole end day", () => {
    expect(matchesDateRange(5_000 + DAY_MS, null, 5_000)).toBe(true)
    expect(matchesDateRange(5_000 + DAY_MS + 1, null, 5_000)).toBe(false)
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

  test("filters by date range", () => {
    const dated = [
      publishLog({ id: "old", timestamp: 1_000 }),
      publishLog({ id: "new", timestamp: DAY_MS * 10 }),
    ]
    expect(
      filterPublishLogs(dated, filters({ startDate: DAY_MS })).map((l) => l.id),
    ).toEqual(["new"])
    expect(
      filterPublishLogs(dated, filters({ endDate: 1_000 })).map((l) => l.id),
    ).toEqual(["old"])
  })

  test("search matches bot, chat and error fields", () => {
    expect(
      filterPublishLogs(logs, filters({ searchQuery: "daily" })).map(
        (l) => l.id,
      ),
    ).toEqual(["a", "b"])
    expect(
      filterPublishLogs(logs, filters({ searchQuery: "not found" })).map(
        (l) => l.id,
      ),
    ).toEqual(["b"])
    expect(filterPublishLogs(logs, filters({ searchQuery: "zzz" }))).toEqual([])
  })

  test("searches request/response JSON only when searchInDetails is on", () => {
    const withDetails = [
      publishLog({ id: "d", fullRequest: { payload: "hidden-token" } }),
    ]
    expect(
      filterPublishLogs(withDetails, filters({ searchQuery: "hidden-token" })),
    ).toEqual([])
    expect(
      filterPublishLogs(
        withDetails,
        filters({ searchQuery: "hidden-token", searchInDetails: true }),
      ).map((l) => l.id),
    ).toEqual(["d"])
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

  test("search matches source", () => {
    expect(
      filterSyncLogs(logs, filters({ searchQuery: "RSS" })).map((l) => l.id),
    ).toEqual(["b"])
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

  test("search matches prompt and response", () => {
    expect(
      filterLlmLogs(logs, filters({ searchQuery: "greeting" })).map(
        (l) => l.id,
      ),
    ).toEqual(["a"])
    expect(
      filterLlmLogs(logs, filters({ searchQuery: "BONJOUR" })).map((l) => l.id),
    ).toEqual(["b"])
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

  test("search matches method case-insensitively", () => {
    expect(
      filterNetworkLogs(logs, filters({ searchQuery: "post" })).map(
        (l) => l.id,
      ),
    ).toEqual(["b"])
  })

  test("telemetry is only searched with searchInDetails", () => {
    expect(filterNetworkLogs(logs, filters({ searchQuery: "berlin" }))).toEqual(
      [],
    )
    expect(
      filterNetworkLogs(
        logs,
        filters({ searchQuery: "berlin", searchInDetails: true }),
      ).map((l) => l.id),
    ).toEqual(["b"])
  })
})

describe("filterEmbeddingLogs", () => {
  const logs = [
    embeddingLog({ id: "a", textCount: 42 }),
    embeddingLog({ id: "b", textCount: 7, error: "quota exceeded" }),
  ]

  test("search matches text count and error", () => {
    expect(
      filterEmbeddingLogs(logs, filters({ searchQuery: "42" })).map(
        (l) => l.id,
      ),
    ).toEqual(["a"])
    expect(
      filterEmbeddingLogs(logs, filters({ searchQuery: "quota" })).map(
        (l) => l.id,
      ),
    ).toEqual(["b"])
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

  test("each field activates the filter state", () => {
    expect(isAnyLogFilterActive(filters({ searchQuery: "x" }))).toBe(true)
    expect(isAnyLogFilterActive(filters({ statusFilter: "failed" }))).toBe(true)
    expect(isAnyLogFilterActive(filters({ startDate: 1 }))).toBe(true)
    expect(isAnyLogFilterActive(filters({ endDate: 1 }))).toBe(true)
    expect(isAnyLogFilterActive(filters({ modelFilter: "gpt" }))).toBe(true)
    expect(isAnyLogFilterActive(filters({ botFilter: "bot" }))).toBe(true)
    expect(isAnyLogFilterActive(filters({ channelFilter: "ch" }))).toBe(true)
    expect(isAnyLogFilterActive(filters({ searchInDetails: true }))).toBe(true)
  })
})
