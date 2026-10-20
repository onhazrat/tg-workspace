/**
 * The quota override wire format (ticket 24): an empty box is inherit (null)
 * and zero is a real limit, and an account's draft comes from its own rows
 * only, so saving one Budget leaves the other two as they were.
 */
import { describe, expect, test } from "bun:test"
import {
  budgetsFrom,
  type Draft,
  draftFrom,
  draftValue,
  overrideDraftFor,
  parseLimit,
  showLimit,
  withLimit,
} from "./limits-model"

describe("the wire format of a box", () => {
  test("empty is inherit, zero is a limit, junk is inherit", () => {
    expect(parseLimit("")).toBeNull()
    expect(parseLimit("   ")).toBeNull()
    expect(parseLimit("0")).toBe(0)
    expect(parseLimit(" 12 ")).toBe(12)
    expect(parseLimit("7.9")).toBe(7)
    expect(parseLimit("-3.5")).toBe(-3)
    expect(parseLimit("abc")).toBeNull()
    expect(parseLimit("Infinity")).toBeNull()
  })

  test("a stored null shows as an empty box and a placeholder of no limit", () => {
    expect(showLimit(null)).toBe("")
    expect(showLimit(undefined)).toBe("")
    expect(showLimit(0)).toBe("0")
  })
})

describe("drafts", () => {
  test("every budget gets a row, missing ones empty", () => {
    expect(
      draftFrom([{ budget: "manual_bulk", allowance: 0, ceiling: null }]),
    ).toEqual({
      auto_sync: { allowance: "", ceiling: "" },
      manual_bulk: { allowance: "0", ceiling: "" },
      manual_single: { allowance: "", ceiling: "" },
    })
  })

  test("an account's draft comes from its own rows and nobody else's", () => {
    const overrides = [
      { userId: "a", budget: "auto_sync", allowance: 1, ceiling: 2 },
      { userId: "b", budget: "auto_sync", allowance: 9, ceiling: 9 },
    ]
    expect(overrideDraftFor(overrides, "a").auto_sync).toEqual({
      allowance: "1",
      ceiling: "2",
    })
    expect(overrideDraftFor(overrides, "c").auto_sync).toEqual({
      allowance: "",
      ceiling: "",
    })
    expect(overrideDraftFor(undefined, "a")).toEqual(draftFrom([]))
  })

  test("editing one field keeps the other and the other budgets", () => {
    const draft = draftFrom([{ budget: "auto_sync", allowance: 5, ceiling: 6 }])
    const next = withLimit(draft, "auto_sync", "ceiling", "")
    expect(next.auto_sync).toEqual({ allowance: "5", ceiling: "" })
    expect(next.manual_bulk).toBe(draft.manual_bulk)
    expect(withLimit({}, "auto_sync", "allowance", "3")).toEqual({
      auto_sync: { allowance: "3", ceiling: "" },
    })
  })

  test("a missing budget reads as an empty box", () => {
    expect(draftValue({}, "auto_sync", "ceiling")).toBe("")
  })

  test("the body names all three budgets, empty as null", () => {
    const draft: Draft = { auto_sync: { allowance: "0", ceiling: "" } }
    expect(budgetsFrom(draft)).toEqual([
      { budget: "auto_sync", allowance: 0, ceiling: null },
      { budget: "manual_bulk", allowance: null, ceiling: null },
      { budget: "manual_single", allowance: null, ceiling: null },
    ])
  })
})
