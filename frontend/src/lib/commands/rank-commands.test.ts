import { describe, expect, it } from "bun:test"

import {
  AFFINITY_WEIGHT,
  filterAndRank,
  querySimilarity,
} from "./rank-commands"
import type { CommandDef } from "./types"

function command(
  id: string,
  label: string,
  overrides: Partial<CommandDef> = {},
): CommandDef {
  return {
    id,
    kind: "action",
    label,
    keywords: [],
    group: "Misc",
    ...overrides,
  } as CommandDef
}

describe("querySimilarity", () => {
  it.each([
    ["", "sync", 0],
    ["sync", "   ", 0],
    ["  Sync   Channel ", "sync channel", 1],
    ["syn", "sync channel", 0.8],
    ["sync channel now", "sync channel", 0.8],
    ["sync channel", "channel sync now", 0.5 * (2 / 3)],
    ["ync", "sync", 0.4],
    ["sync", "async", 0.4],
    ["snc", "sync", 0.3],
    ["xyz", "sync", 0],
  ])("%p against %p is %p", (input, stored, expected) => {
    expect(querySimilarity(input, stored)).toBeCloseTo(expected)
  })
})

describe("filterAndRank", () => {
  const commands = [
    command("open-logs", "Logs"),
    command("open-log-viewer", "Log viewer"),
    command("export-catalog", "Export catalog"),
    command("sync-all", "Sync everything", { keywords: ["", "refresh"] }),
    command("navigate-tab-channels", "Go to channels", { group: "Navigate" }),
    command("navigate-tab-log", "Go elsewhere", { group: "Navigate" }),
  ]

  const scores = (query: string) =>
    Object.fromEntries(
      filterAndRank(commands, query, []).map(({ command, score }) => [
        command.id,
        score,
      ]),
    )

  it("keeps every command, in order, at score 1 for a blank query", () => {
    const ranked = filterAndRank(commands, "   ", [])
    expect(ranked.map((entry) => entry.command.id)).toEqual(
      commands.map((entry) => entry.id),
    )
    expect(ranked.every((entry) => entry.score === 1)).toBe(true)
  })

  it("scores exact over prefix over substring over fuzzy, and drops misses", () => {
    expect(scores("log")).toEqual({
      "navigate-tab-log": 1.15,
      "open-log-viewer": 0.9,
      "open-logs": 0.9,
      "export-catalog": 0.75,
    })
    expect(scores("logs")).toEqual({ "open-logs": 1 })
    // "lgv" is only a subsequence of "log viewer".
    expect(scores("lgv")).toEqual({ "open-log-viewer": 0.55 })
  })

  it("matches keywords, the group and the id, skipping blank keywords", () => {
    expect(scores("refresh")).toEqual({ "sync-all": 1 })
    expect(scores("navigate")).toEqual({
      "navigate-tab-channels": 1,
      "navigate-tab-log": 1,
    })
    expect(scores("sync all")).toEqual({ "sync-all": 1 })
  })

  it("lifts a navigate-tab command whose tab id is the query", () => {
    expect(scores("channels")["navigate-tab-channels"]).toBe(1.15)
    // Only the whole tab id counts; a prefix of it is an ordinary match.
    expect(scores("chan")["navigate-tab-channels"]).toBe(0.75)
  })

  it("sorts by score, then by label", () => {
    const ranked = filterAndRank(commands, "log", [])
    expect(ranked.map((entry) => entry.command.label)).toEqual([
      "Go elsewhere",
      "Log viewer",
      "Logs",
      "Export catalog",
    ])
  })

  it("adds the affinity boost for past picks of that command", () => {
    const entries = [
      {
        query: "log",
        commandId: "open-logs",
        count: 3,
        lastUsedAt: Date.now(),
      },
    ]
    const ranked = filterAndRank(commands, "log", entries)
    const logs = ranked.find((entry) => entry.command.id === "open-logs")
    expect(logs?.score).toBeCloseTo(0.9 + Math.log1p(3) * AFFINITY_WEIGHT, 3)
    // 0.9 plus the boost now beats the 1.15 of the navigate-tab exact match.
    expect(ranked[0].command.id).toBe("open-logs")
  })
})
