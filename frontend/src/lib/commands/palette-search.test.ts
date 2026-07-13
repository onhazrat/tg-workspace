import { describe, expect, test } from "bun:test"
import type { CommandContext, CommandDef } from "@/lib/commands/types"
import type { Summary } from "@/types"
import { buildSearchResultsState } from "./palette-search"

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

function makeSummary(id: string, text: string, timestamp: number): Summary {
  return {
    id,
    text,
    channels: [],
    startDate: 0,
    endDate: 1,
    language: "en",
    timestamp,
  }
}

const ctx = {
  summariesHistory: [
    makeSummary("s1", "weekly market wrap", 1),
    makeSummary("s2", "tech digest", 2),
  ],
} as unknown as CommandContext

describe("buildSearchResultsState", () => {
  test("returns null for commands without a searchResultsKind", async () => {
    const state = await buildSearchResultsState(makeCommand({}), ctx, "query")
    expect(state).toBeNull()
  })

  test("builds trimmed summaries results with total count", async () => {
    const command = makeCommand({ searchResultsKind: "summaries" })
    const state = await buildSearchResultsState(command, ctx, "  market  ")
    expect(state).not.toBeNull()
    expect(state?.kind).toBe("summaries")
    expect(state?.query).toBe("market")
    expect((state?.items as Summary[]).map((item) => item.id)).toEqual(["s1"])
    expect(state?.totalCount).toBe(1)
  })

  test("empty query returns all summaries newest first", async () => {
    const command = makeCommand({ searchResultsKind: "summaries" })
    const state = await buildSearchResultsState(command, ctx, "   ")
    expect(state?.query).toBe("")
    expect((state?.items as Summary[]).map((item) => item.id)).toEqual([
      "s2",
      "s1",
    ])
    expect(state?.totalCount).toBe(2)
  })
})
