import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { CommandContext, CommandDef } from "@/lib/commands/types"
import type { SummaryListItem } from "@/types"

function makeSummary(
  id: string,
  text: string,
  timestamp: number,
): SummaryListItem {
  return {
    id,
    text,
    channels: [],
    startDate: 0,
    endDate: 1,
    language: "en",
    timestamp,
    chatMessageCount: 0,
  }
}

const ALL_SUMMARIES = [
  makeSummary("s1", "weekly market wrap", 1),
  makeSummary("s2", "tech digest", 2),
]

/** Records what the palette asked the server for. */
let searchCalls: (string | undefined)[] = []

// Summary search runs server-side now — `promptText` is matched in SQL and is
// no longer shipped to the client — so the palette calls the repository rather
// than filtering `ctx.summariesHistory` in memory.
mock.module("@/lib/repository", () => ({
  listSummaries: async (options: { search?: string } = {}) => {
    searchCalls.push(options.search)
    if (!options.search) return ALL_SUMMARIES
    const q = options.search.toLowerCase()
    return ALL_SUMMARIES.filter((s) => s.text.toLowerCase().includes(q))
  },
  getPostsByDateRange: async () => [],
}))

const { buildSearchResultsState } = await import("./palette-search")

function makeCommand(overrides: Partial<CommandDef>): CommandDef {
  return {
    id: "cmd",
    kind: "editor",
    label: "Command",
    keywords: [],
    group: "Search",
    run: () => {},
    ...overrides,
  }
}

const ctx = { summariesHistory: ALL_SUMMARIES } as unknown as CommandContext

describe("buildSearchResultsState", () => {
  beforeEach(() => {
    searchCalls = []
  })

  test("returns null for commands without a searchResultsKind", async () => {
    const state = await buildSearchResultsState(makeCommand({}), ctx, "query")
    expect(state).toBeNull()
  })

  test("builds trimmed summaries results with total count", async () => {
    const command = makeCommand({ searchResultsKind: "summaries" })
    const state = await buildSearchResultsState(command, ctx, "  market  ")

    expect(state?.kind).toBe("summaries")
    expect(state?.query).toBe("market")
    expect((state!.items as SummaryListItem[]).map((i) => i.id)).toEqual(["s1"])
    expect(state?.totalCount).toBe(1)
  })

  test("passes the trimmed query to the server rather than filtering locally", async () => {
    const command = makeCommand({ searchResultsKind: "summaries" })
    await buildSearchResultsState(command, ctx, "  market  ")
    expect(searchCalls).toEqual(["market"])
  })

  test("empty query returns all summaries newest first", async () => {
    const command = makeCommand({ searchResultsKind: "summaries" })
    const state = await buildSearchResultsState(command, ctx, "   ")

    expect(state?.query).toBe("")
    expect((state!.items as SummaryListItem[]).map((i) => i.id)).toEqual([
      "s2",
      "s1",
    ])
    expect(state?.totalCount).toBe(2)
    // No search term is sent for a blank query.
    expect(searchCalls).toEqual([undefined])
  })
})
