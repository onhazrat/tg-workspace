/**
 * `SummaryView`'s decision. What is pinned: the list row wins over the
 * detail fetch but the detail alone still opens a Summary, the live stream wins
 * over the stored text.
 */
import { describe, expect, test } from "bun:test"

import type { Summary } from "@/types"
import { summaryViewState } from "./summary-view-model"

const saved = (over: Partial<Summary>): Summary => ({
  id: "s1",
  text: "stored",
  language: "English",
  postCount: 1,
  timestamp: 0,
  ...over,
})

const state = (over: Partial<Parameters<typeof summaryViewState>[0]>) =>
  summaryViewState({
    history: [],
    currentSummaryId: "s1",
    detail: undefined,
    streamed: null,
    regenerating: new Set(),
    summarizing: false,
    ...over,
  })

describe("summaryViewState", () => {
  test("nothing open: no body, not pending, not running", () => {
    expect(state({ currentSummaryId: null })).toEqual({
      currentSummary: undefined,
      summaryBody: null,
      isPending: false,
      running: false,
    })
  })

  test("the list row wins, the detail supplies the text", () => {
    const row = { ...saved({ text: "row" }), chatMessageCount: 0 }
    const result = state({ history: [row], detail: saved({}) })
    expect(result.currentSummary).toBe(row)
    expect(result.summaryBody).toBe("stored")
  })

  test("the detail alone opens it, and the stream wins over its text", () => {
    const detail = saved({ status: "pending" })
    const result = state({ detail, streamed: "live" })
    expect(result.currentSummary).toBe(detail)
    expect(result.summaryBody).toBe("live")
    expect(result.isPending).toBe(true)
  })

  test("running while generating, or while this one regenerates", () => {
    expect(state({ summarizing: true }).running).toBe(true)
    expect(
      state({ detail: saved({}), regenerating: new Set(["s1"]) }).running,
    ).toBe(true)
    expect(
      state({ detail: saved({}), regenerating: new Set(["s2"]) }).running,
    ).toBe(false)
  })

  test("a pending item its own Generate is still filling offers no paste", () => {
    // Generate files the item as pending before asking the model; a paste
    // accepted now would be overwritten when the run finishes.
    const detail = saved({ status: "pending" })
    const live = state({ detail, regenerating: new Set(["s1"]) })
    expect(live.isPending).toBe(false)
    expect(live.running).toBe(true)
    expect(state({ detail }).isPending).toBe(true)
  })
})
