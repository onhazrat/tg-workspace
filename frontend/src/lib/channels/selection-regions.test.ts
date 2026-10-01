import { describe, expect, it } from "bun:test"

import {
  actionTargets,
  applyRegions,
  editFor,
  hiddenSelection,
  hiddenSelectionNote,
  isNoop,
  regionsOf,
  SELECTION_EDITS,
  type SelectionEditKey,
  selectionChange,
  UNCHANGED,
} from "./selection-regions"

// S − F = {h1, h2}, S ∩ F = {b1}, F − S = {f1, f2}
const selection = new Set(["h1", "h2", "b1"])
const shown = ["b1", "f1", "f2"]

const edit = (key: SelectionEditKey) => {
  const found = SELECTION_EDITS.find((e) => e.key === key)
  if (!found) throw new Error(`no edit ${key}`)
  return [...applyRegions(selection, shown, found.regions)].sort()
}

describe("regionsOf", () => {
  it("splits the selection and the Shown Channels into three regions", () => {
    expect(regionsOf(selection, shown)).toEqual({
      hidden: ["h1", "h2"],
      both: ["b1"],
      fresh: ["f1", "f2"],
    })
  })
})

describe("the five edits", () => {
  it("Add shown keeps everything and adds what is shown", () => {
    expect(edit("add")).toEqual(["b1", "f1", "f2", "h1", "h2"])
  })

  it("Remove shown drops the shown part of the selection", () => {
    expect(edit("remove")).toEqual(["h1", "h2"])
  })

  it("Keep only shown drops the Hidden selection", () => {
    expect(edit("keep")).toEqual(["b1"])
  })

  it("Invert shown flips the shown Channels and leaves the hidden ones", () => {
    expect(edit("invert")).toEqual(["f1", "f2", "h1", "h2"])
  })

  it("Select only shown makes the selection what is shown", () => {
    expect(edit("replace")).toEqual(["b1", "f1", "f2"])
  })

  it("names every edit exactly once, in the spec's order", () => {
    expect(SELECTION_EDITS.map((e) => e.label)).toEqual([
      "Add shown",
      "Remove shown",
      "Keep only shown",
      "Invert shown",
      "Select only shown",
    ])
  })
})

describe("editFor", () => {
  it("names the preset a picture matches, and nothing for any other", () => {
    expect(editFor({ hidden: false, both: true, fresh: true })?.key).toBe(
      "replace",
    )
    expect(editFor(UNCHANGED)).toBeUndefined()
    expect(editFor({ hidden: false, both: false, fresh: true })).toBeUndefined()
  })
})

describe("isNoop", () => {
  it("is true for the unchanged picture", () => {
    expect(isNoop(selection, shown, UNCHANGED)).toBe(true)
  })

  it("is false once a non-empty region changes", () => {
    for (const e of SELECTION_EDITS) {
      expect(isNoop(selection, shown, e.regions)).toBe(false)
    }
  })

  it("is true when the only region that changes is empty", () => {
    // Nothing hidden: dropping the Hidden selection changes nothing.
    const allShown = new Set(["b1"])
    expect(
      isNoop(allShown, shown, { hidden: false, both: true, fresh: false }),
    ).toBe(true)
    // Nothing fresh: adding the shown Channels changes nothing.
    expect(
      isNoop(selection, ["b1"], { hidden: true, both: true, fresh: true }),
    ).toBe(true)
  })

  it("agrees with applying the regions", () => {
    for (const e of SELECTION_EDITS) {
      const after = applyRegions(selection, shown, e.regions)
      const same =
        after.size === selection.size &&
        [...after].every((n) => selection.has(n))
      expect(isNoop(selection, shown, e.regions)).toBe(same)
    }
  })
})

describe("selectionChange", () => {
  it("counts what a picture drops and adds", () => {
    expect(
      selectionChange(selection, shown, {
        hidden: false,
        both: true,
        fresh: true,
      }),
    ).toEqual({ before: 3, after: 3, dropped: 2, added: 2 })
    expect(selectionChange(selection, shown, UNCHANGED)).toEqual({
      before: 3,
      after: 3,
      dropped: 0,
      added: 0,
    })
  })
})

describe("the action limit", () => {
  it("on Shown, yields only the selected Shown Channels", () => {
    expect([...actionTargets(selection, shown, "shown")]).toEqual(["b1"])
  })

  it("on All, yields the whole selection", () => {
    expect(actionTargets(selection, shown, "all")).toEqual(selection)
  })

  it("the Hidden selection is what the filters hide of the selection", () => {
    expect([...hiddenSelection(selection, shown)]).toEqual(["h1", "h2"])
  })
})

describe("hiddenSelectionNote", () => {
  it("names the Hidden selection a limited action leaves alone", () => {
    expect(hiddenSelectionNote(40, "shown")).toBe(
      "40 selected Channels hidden by filters are not affected.",
    )
    expect(hiddenSelectionNote(1, "shown")).toBe(
      "1 selected Channel hidden by filters is not affected.",
    )
  })

  it("says how much of an unlimited action is off screen", () => {
    expect(hiddenSelectionNote(40, "all")).toBe(
      "40 of them are hidden by filters.",
    )
  })

  it("says nothing while nothing is hidden", () => {
    expect(hiddenSelectionNote(0, "shown")).toBe("")
    expect(hiddenSelectionNote(0, "all")).toBe("")
  })
})
