import { describe, expect, it } from "bun:test"

import { rangeSelect } from "./range-select"

const order = ["a", "b", "c", "d", "e"]

const click = (
  selection: string[],
  anchor: string | null,
  clicked: string,
  shift: boolean,
) => {
  const result = rangeSelect({
    selection: new Set(selection),
    order,
    anchor,
    clicked,
    shift,
  })
  return { selection: [...result.selection].sort(), anchor: result.anchor }
}

describe("rangeSelect", () => {
  it("a plain click toggles the clicked Channel alone", () => {
    expect(click(["a"], "a", "c", false).selection).toEqual(["a", "c"])
    expect(click(["a", "c"], "a", "c", false).selection).toEqual(["a"])
  })

  it("a shift-click selects the run forward from the anchor", () => {
    expect(click(["b"], "b", "d", true).selection).toEqual(["b", "c", "d"])
  })

  it("a shift-click selects the run backward from the anchor", () => {
    expect(click(["d"], "d", "b", true).selection).toEqual(["b", "c", "d"])
  })

  it("a shift-click on a selected Channel deselects the run", () => {
    expect(click(["a", "b", "c", "d", "e"], "b", "d", true).selection).toEqual([
      "a",
      "e",
    ])
  })

  it("the run takes the clicked Channel's new state, whatever the anchor's", () => {
    // Anchor b is unselected, clicked d is unselected: the run becomes selected.
    expect(click(["c"], "b", "d", true).selection).toEqual(["b", "c", "d"])
  })

  it("leaves selections outside the run untouched", () => {
    expect(click(["a", "e", "zz"], "b", "c", true).selection).toEqual([
      "a",
      "b",
      "c",
      "e",
      "zz",
    ])
  })

  it("an anchor no longer on screen makes a shift-click a plain toggle", () => {
    expect(click(["a"], "gone", "d", true).selection).toEqual(["a", "d"])
  })

  it("no anchor makes a shift-click a plain toggle", () => {
    expect(click(["a"], null, "d", true).selection).toEqual(["a", "d"])
  })

  it("an anchor equal to the clicked Channel toggles that Channel alone", () => {
    expect(click(["a"], "c", "c", true).selection).toEqual(["a", "c"])
  })

  it("the anchor moves to the clicked Channel on every click", () => {
    expect(click([], null, "b", false).anchor).toBe("b")
    expect(click([], "b", "d", true).anchor).toBe("d")
    expect(click([], "gone", "e", true).anchor).toBe("e")
  })

  it("does not mutate the selection it was given", () => {
    const selection = new Set(["a"])
    rangeSelect({ selection, order, anchor: "a", clicked: "c", shift: true })
    expect([...selection]).toEqual(["a"])
  })
})
