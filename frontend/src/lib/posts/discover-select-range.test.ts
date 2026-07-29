import { describe, expect, test } from "bun:test"
import { type DiscoverSelectableRow, selectRange } from "./discover-selection"

const rows: DiscoverSelectableRow[] = [
  { name: "a", isFollowed: false },
  { name: "b", isFollowed: false },
  { name: "c", isFollowed: true },
  { name: "d", isFollowed: false },
  { name: "e", isFollowed: false },
]

describe("selectRange", () => {
  test("selects every unfollowed row between anchor and target", () => {
    const next = selectRange(rows, 0, 3, new Set(), true)
    expect([...next].sort()).toEqual(["a", "b", "d"])
  })

  test("works when the target is above the anchor", () => {
    const next = selectRange(rows, 3, 0, new Set(), true)
    expect([...next].sort()).toEqual(["a", "b", "d"])
  })

  test("skips followed rows rather than selecting them", () => {
    // Their checkbox is disabled, so a sweep must not do what a click cannot.
    const next = selectRange(rows, 0, 4, new Set(), true)
    expect(next.has("c")).toBe(false)
  })

  test("deselects the range when the clicked row is being unchecked", () => {
    const next = selectRange(rows, 0, 3, new Set(["a", "b", "d", "e"]), false)
    expect([...next]).toEqual(["e"])
  })

  test("both endpoints are included", () => {
    const next = selectRange(rows, 1, 1, new Set(), true)
    expect([...next]).toEqual(["b"])
  })

  test("leaves rows outside the range untouched", () => {
    const next = selectRange(rows, 0, 1, new Set(["e"]), true)
    expect([...next].sort()).toEqual(["a", "b", "e"])
  })

  test("a missing anchor is a no-op rather than selecting everything", () => {
    // Guards the case where the anchor row was filtered out between clicks.
    const next = selectRange(rows, -1, 3, new Set(["a"]), true)
    expect([...next]).toEqual(["a"])
  })

  test("does not mutate the input set", () => {
    const original = new Set<string>()
    selectRange(rows, 0, 3, original, true)
    expect(original.size).toBe(0)
  })

  test("out-of-bounds indices do not throw", () => {
    expect(() => selectRange(rows, 0, 99, new Set(), true)).not.toThrow()
  })
})
