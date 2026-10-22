/**
 * History's filters in the URL: what a link keeps, what it drops, and that
 * each filter round-trips through the workspace search.
 */
import { describe, expect, test } from "bun:test"
import { buildChannelOpRegistry } from "@/lib/commands/channel-ops"
import { buildExtendedCommands } from "@/lib/commands/extended-commands"
import type { CommandContext } from "@/lib/commands/types"
import {
  DEFAULT_HISTORY_PARAMS,
  type HistoryParams,
  historyPaletteBinding,
  historySearchPatch,
  readHistoryParams,
  validateHistorySearch,
} from "./history-params"

/** What a navigation leaves in the URL: the patch, minus removed keys. */
const roundTrip = (patch: Partial<HistoryParams>) =>
  readHistoryParams(
    validateHistorySearch(
      Object.fromEntries(
        Object.entries(historySearchPatch(patch)).filter(
          ([, v]) => v !== undefined,
        ),
      ),
    ),
  )

describe("the History URL parameters", () => {
  test("an empty URL is the default list", () => {
    expect(readHistoryParams({})).toEqual(DEFAULT_HISTORY_PARAMS)
    expect(DEFAULT_HISTORY_PARAMS).toEqual({
      kind: null,
      status: null,
      search: "",
      starred: false,
      bound: { mode: "live" },
      moment: "written",
      sort: "written",
      descending: true,
    })
  })

  test("every filter round-trips", () => {
    const params: HistoryParams = {
      kind: "tag",
      status: "pending",
      search: "iran news",
      starred: true,
      bound: { mode: "live", start: -7 * 86_400_000 },
      moment: "window",
      sort: "window",
      descending: false,
    }
    expect(roundTrip(params)).toEqual(params)
  })

  test("a Fixed bound with both ends round-trips to the minute", () => {
    const bound = {
      mode: "fixed" as const,
      start: Date.UTC(2026, 9, 1),
      end: Date.UTC(2026, 9, 15, 12, 30),
    }
    expect(roundTrip({ bound }).bound).toEqual(bound)
    expect(historySearchPatch({ bound }).historyTime).toBe(
      "2026-10-01T00:00Z..2026-10-15T12:30Z",
    )
  })

  test("defaults are written as absent, so a default list has a clean URL", () => {
    expect(historySearchPatch(DEFAULT_HISTORY_PARAMS)).toEqual({
      historyKind: undefined,
      historyStatus: undefined,
      historyQ: undefined,
      historyStarred: undefined,
      historyTime: undefined,
      historyMoment: undefined,
      historySort: undefined,
      historyOrder: undefined,
    })
    // A blank search and a bound with no ends are the defaults too.
    expect(historySearchPatch({ search: "  " }).historyQ).toBeUndefined()
    expect(
      historySearchPatch({ bound: { mode: "fixed" } }).historyTime,
    ).toBeUndefined()
  })

  test("only the keys of a patch are touched", () => {
    expect(historySearchPatch({ kind: "chat" })).toEqual({
      historyKind: "chat",
    })
  })

  test("the search keeps what was typed, spaces and all", () => {
    expect(historySearchPatch({ search: "iran " }).historyQ).toBe("iran ")
  })

  test("a broken or unknown value is dropped, never guessed at", () => {
    expect(
      validateHistorySearch({
        historyKind: "post",
        historyStatus: "broken",
        historyQ: 7,
        historyStarred: "yes",
        historyTime: "-7x..",
        historyMoment: "posted",
        historySort: "title",
        historyOrder: "sideways",
      }),
    ).toEqual({})
    // Mixed modes, an end before its start, and no end at all.
    for (const historyTime of ["-7d..2026-10-01T00:00Z", "now..-1d", ".."])
      expect(validateHistorySearch({ historyTime })).toEqual({})
  })

  test("the router's parsed booleans and strings both read as on", () => {
    expect(validateHistorySearch({ historyStarred: true })).toEqual({
      historyStarred: true,
    })
    expect(validateHistorySearch({ historyStarred: "true" })).toEqual({
      historyStarred: true,
    })
  })
})

describe("the command palette", () => {
  const binding = (params: Partial<HistoryParams> = {}) => {
    const patches: Partial<HistoryParams>[] = []
    const ctx = historyPaletteBinding(
      { ...DEFAULT_HISTORY_PARAMS, ...params },
      (patch) => patches.push(patch),
    )
    return { ctx: ctx as unknown as CommandContext, patches }
  }

  test("History search writes the bar's search", () => {
    const op = buildChannelOpRegistry().find((o) => o.id === "search-summaries")
    const { ctx, patches } = binding({ search: "iran" })
    expect(op?.editorField?.getValue(ctx)).toBe("iran")
    op?.editorField?.apply(ctx, "  oil  ")
    expect(patches).toEqual([{ search: "oil" }])
  })

  test("Show Starred Summaries Only flips the bar's Starred", () => {
    const command = buildExtendedCommands().find(
      (c) => c.id === "show-starred-summaries-only",
    )
    const off = binding()
    expect(command?.getBadge?.(off.ctx)).toBe("OFF")
    void command?.run(off.ctx)
    expect(off.patches).toEqual([{ starred: true }])
    const on = binding({ starred: true })
    expect(command?.getBadge?.(on.ctx)).toBe("ON")
    void command?.run(on.ctx)
    expect(on.patches).toEqual([{ starred: false }])
  })
})
