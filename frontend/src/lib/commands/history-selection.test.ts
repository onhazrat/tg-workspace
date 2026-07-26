import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { SummaryListItem } from "@/types"
import {
  applyHistorySummarySelection,
  type HistorySummarySelectionContext,
} from "./history-selection"

function summary(overrides: Partial<SummaryListItem> = {}): SummaryListItem {
  return {
    id: "s1",
    text: "A report body",
    channels: ["alpha", "beta"],
    startDate: 1_000,
    endDate: 2_000,
    language: "Persian",
    model: "gemini-3.1-pro-preview",
    timestamp: 1_500,
    chatMessageCount: 0,
    ...overrides,
  }
}

/** Records every setter call so a test can assert what a selection touched. */
function spyContext() {
  const calls: Record<string, unknown[]> = {}
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls[name] ??= []
      calls[name].push(args.length === 1 ? args[0] : args)
    }

  const ctx: HistorySummarySelectionContext = {
    setActiveTab: record("setActiveTab"),
    setDateRange: (start, end) => record("setDateRange")([start, end]),
    setSelectedChannels: record("setSelectedChannels"),
    setChatMessages: record("setChatMessages"),
    setCurrentSummaryId: record("setCurrentSummaryId"),
    setPostSearch: record("setPostSearch"),
    setSemanticSearchQuery: record("setSemanticSearchQuery"),
    setSemanticSearchRespectsTimeRange: record(
      "setSemanticSearchRespectsTimeRange",
    ),
    setSemanticSearchRespectsChannels: record(
      "setSemanticSearchRespectsChannels",
    ),
    setRelatedPostSearch: record("setRelatedPostSearch"),
    setSummary: record("setSummary"),
    loadDetail: async () => undefined,
  }

  return { ctx, calls }
}

describe("applyHistorySummarySelection", () => {
  it("restores the view from the record", async () => {
    const { ctx, calls } = spyContext()
    await applyHistorySummarySelection(summary(), ctx)

    expect(calls.setSummary).toEqual(["A report body"])
    expect(calls.setCurrentSummaryId).toEqual(["s1"])
    expect(calls.setSelectedChannels).toEqual([new Set(["alpha", "beta"])])
    expect(calls.setActiveTab).toEqual(["summary"])
  })

  it("blanks the body for a pending record instead of showing its placeholder", async () => {
    const { ctx, calls } = spyContext()
    await applyHistorySummarySelection(
      summary({ status: "pending", text: "prompt text" }),
      ctx,
    )
    expect(calls.setSummary).toEqual([null])
  })

  /**
   * A6, both halves. Opening a saved report used to call `setSelectedModel` and
   * `setAiLanguage`, silently rewriting the user's "model/language for the next
   * generation". The view is restored from the record; nothing global is written.
   * `SummaryView` renders the record's own model and direction from the record.
   */
  it("writes nothing to global settings", async () => {
    const { ctx, calls } = spyContext()
    await applyHistorySummarySelection(summary(), ctx)

    for (const name of Object.keys(calls)) {
      expect(name).not.toMatch(/^set(SelectedModel|AiLanguage)$/)
    }
    expect("settings" in ctx).toBe(false)
  })

  it("keeps the selection context free of settings mutators", () => {
    // Source-level guard: re-adding a global write here would have to reintroduce
    // one of these names, and would fail this test rather than ship silently.
    const source = readFileSync(
      join(import.meta.dir, "history-selection.ts"),
      "utf8",
    )
    expect(source).not.toContain("setSelectedModel")
    expect(source).not.toContain("setAiLanguage")
  })
})
