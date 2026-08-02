import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { queryKeys } from "@/hooks/queryKeys"
import { queryClient } from "@/lib/queryClient"
import { resetInFlight } from "@/lib/singleFlight"
import type { Summary, TagRun } from "@/types"
import {
  deleteSummary,
  deleteTagRun,
  getSummary,
  getTagRun,
  listSummaries,
  listTagRuns,
  type SummariesApi,
  saveSummary,
  upsertTagRun,
} from "./store"

/**
 * The summaries + tag-runs contract after A3.3.
 *
 * Same rule as channels, not logs: a write must **not** invalidate. Every
 * autosave of the summary currently streaming would otherwise refetch the whole
 * history — once per token batch. Callers that do want a refresh say so
 * (`DataContext.loadHistory()` is `useInvalidateSummaries()`).
 *
 * `listTagRuns` and `getTagRun` swallow failures and `listSummaries` does not;
 * that asymmetry is pre-existing and load-bearing, so it is pinned here.
 */

let listedSearch: Array<string | undefined> = []
let calls: string[] = []
let fail = false

const summary = (id: string): Summary => ({ id, timestamp: 1 }) as Summary

const fakeApi = {
  listSummaries: async (params?: { search?: string }) => {
    listedSearch.push(params?.search)
    calls.push("listSummaries")
    if (fail) throw new Error("down")
    return [{ id: "s1", timestamp: 1 }]
  },
  getSummary: async (id: string) => {
    calls.push(`getSummary:${id}`)
    if (fail) throw new Error("down")
    return summary(id)
  },
  upsertSummary: async (id: string, body: Summary) => {
    calls.push(`upsertSummary:${id}`)
    return body
  },
  deleteSummary: async (id: string) => {
    calls.push(`deleteSummary:${id}`)
    return { status: "deleted" }
  },
  listTagRuns: async () => {
    calls.push("listTagRuns")
    if (fail) throw new Error("down")
    return [{ id: "t1" }]
  },
  getTagRun: async (id: string) => {
    calls.push(`getTagRun:${id}`)
    if (fail) throw new Error("down")
    return { id } as TagRun
  },
  upsertTagRun: async (id: string, body: TagRun) => {
    calls.push(`upsertTagRun:${id}`)
    return body
  },
  deleteTagRun: async (id: string) => {
    calls.push(`deleteTagRun:${id}`)
    return { status: "deleted" }
  },
} as unknown as SummariesApi

function seedFresh() {
  queryClient.setQueryData(queryKeys.summaries, [])
}

function isStale(): boolean {
  return (
    queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.summaries })
      ?.isStale() ?? true
  )
}

beforeEach(() => {
  listedSearch = []
  calls = []
  fail = false
  resetInFlight()
  queryClient.clear()
})

afterEach(() => {
  resetInFlight()
  queryClient.clear()
})

describe("listSummaries", () => {
  it("passes the search term to the server", async () => {
    await listSummaries({ search: "quarterly" }, fakeApi)

    // Matching happens in SQL: `promptText` is ~94% of the old payload and is
    // no longer shipped, so a local filter cannot see the column it matches on.
    expect(listedSearch).toEqual(["quarterly"])
  })

  it("omits the search parameter entirely when there is none", async () => {
    await listSummaries({}, fakeApi)

    expect(listedSearch).toEqual([undefined])
  })

  it("de-duplicates concurrent identical reads", async () => {
    await Promise.all([
      listSummaries({}, fakeApi),
      listSummaries({}, fakeApi),
      listSummaries({}, fakeApi),
    ])

    // Two non-React callers (`search-filters.ts`, `data-transfer`) never reach
    // react-query's de-duplication, which is why `singleFlight` survives here.
    expect(calls.filter((c) => c === "listSummaries")).toHaveLength(1)
  })

  it("does NOT merge reads with different search terms", async () => {
    await Promise.all([
      listSummaries({ search: "a" }, fakeApi),
      listSummaries({ search: "b" }, fakeApi),
    ])

    expect(listedSearch.sort()).toEqual(["a", "b"])
  })

  it("propagates a failure rather than answering from a local cache", async () => {
    fail = true

    // The mirror it used to fall back to could only hold an *unfiltered* list.
    await expect(listSummaries({ search: "x" }, fakeApi)).rejects.toThrow()
  })
})

describe("writes do NOT invalidate the summaries query", () => {
  it("saveSummary leaves the cached history fresh", async () => {
    seedFresh()
    expect(isStale()).toBe(false)

    await saveSummary(summary("s1"), fakeApi)

    expect(calls).toEqual(["upsertSummary:s1"])
    expect(isStale()).toBe(false)
  })

  it("deleteSummary leaves the cached history fresh", async () => {
    seedFresh()

    await deleteSummary("s1", fakeApi)

    expect(isStale()).toBe(false)
  })

  it("a write does not refetch the history either", async () => {
    seedFresh()

    await saveSummary(summary("s1"), fakeApi)

    expect(calls).not.toContain("listSummaries")
  })
})

describe("getSummary", () => {
  it("de-duplicates concurrent reads of the same id", async () => {
    await Promise.all([getSummary("s1", fakeApi), getSummary("s1", fakeApi)])

    expect(calls.filter((c) => c === "getSummary:s1")).toHaveLength(1)
  })

  it("does not merge different ids", async () => {
    await Promise.all([getSummary("s1", fakeApi), getSummary("s2", fakeApi)])

    expect(calls).toContain("getSummary:s1")
    expect(calls).toContain("getSummary:s2")
  })
})

describe("tag runs swallow failures, deliberately", () => {
  it("listTagRuns returns [] rather than throwing", async () => {
    fail = true

    // A side panel must not take down the view hosting it.
    expect(await listTagRuns(fakeApi)).toEqual([])
  })

  it("getTagRun returns undefined rather than throwing", async () => {
    fail = true

    expect(await getTagRun("t1", fakeApi)).toBeUndefined()
  })

  it("writes pass through and do not invalidate", async () => {
    seedFresh()

    await upsertTagRun({ id: "t1" } as TagRun, fakeApi)
    await deleteTagRun("t1", fakeApi)

    expect(calls).toEqual(["upsertTagRun:t1", "deleteTagRun:t1"])
    expect(isStale()).toBe(false)
  })
})
