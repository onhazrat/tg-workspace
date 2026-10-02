import { beforeEach, describe, expect, it } from "bun:test"

import { addPostFunnel, emptyPostFilter, printPostFilter } from "./post-filter"
import {
  appendSteps,
  DEFAULT_SELECTION,
  EMPTY_SNAPSHOT,
  facetRule,
  isExpressible,
  loadSelection,
  MAX_PICKS,
  MAX_RULES,
  type PostFilterSnapshot,
  type PostSelection,
  pick,
  regionCounts,
  regionSteps,
  removeChip,
  rule,
  runPicks,
  SELECTION_STORAGE_KEY,
  type SelectionChip,
  saveSelection,
  selectionBody,
  selectionChips,
  snapshotOf,
} from "./post-selection"

/**
 * The Post selection's step list (PTR-05): what the browser does to it.
 * The server evaluates it; `test_post_selection.py` asserts that.
 */

const arabic: PostFilterSnapshot = {
  ...EMPTY_SNAPSHOT,
  tree: addPostFunnel(emptyPostFilter(), "language", "ar"),
}
const post = (id: number, channelName = "chan") => ({ channelName, id })

const steps = (result: PostSelection | string): PostSelection => {
  if (typeof result === "string") throw new Error(result)
  return result
}

describe("appendSteps", () => {
  it("appends a rule over a filter and a Pick after what is there", () => {
    const next = steps(
      appendSteps(DEFAULT_SELECTION, [
        rule(false, arabic),
        pick(false, post(1)),
      ]),
    )

    expect(next).toEqual([
      DEFAULT_SELECTION[0],
      rule(false, arabic),
      pick(false, post(1)),
    ])
  })

  it("replaces everything with a select-all or deselect-all over an empty filter", () => {
    const busy = steps(
      appendSteps(DEFAULT_SELECTION, [
        rule(false, arabic),
        pick(true, post(2)),
      ]),
    )

    expect(steps(appendSteps(busy, [rule(false)]))).toEqual([rule(false)])
    expect(steps(appendSteps(busy, [rule(true)]))).toEqual([rule(true)])
  })

  it("keeps a rule with a keyword or a cap, which does not reach every Post", () => {
    const keyword = { ...EMPTY_SNAPSHOT, keyword: "tehran" }
    const capped = { ...EMPTY_SNAPSHOT, maxPerChannel: 5 }

    expect(
      steps(appendSteps(DEFAULT_SELECTION, [rule(false, keyword)])),
    ).toHaveLength(2)
    expect(
      steps(appendSteps(DEFAULT_SELECTION, [rule(false, capped)])),
    ).toHaveLength(2)
  })

  it("keeps a second Pick of one Post beside the first, so a chip undoes one step", () => {
    const arabicFirst = steps(
      appendSteps(DEFAULT_SELECTION, [
        pick(false, post(1)),
        rule(false, arabic),
      ]),
    )
    const repicked = steps(appendSteps(arabicFirst, [pick(true, post(1))]))

    expect(repicked).toHaveLength(4)
    // Removing the last chip leaves the first Pick deciding the Post again.
    const last = selectionChips(repicked).at(-1) as SelectionChip
    expect(removeChip(repicked, last)).toEqual(arabicFirst)
  })

  it("refuses past the Pick cap and suggests a rule", () => {
    const full = Array.from({ length: MAX_PICKS }, (_, i) =>
      pick(false, post(i)),
    )
    const atCap = steps(appendSteps(DEFAULT_SELECTION, full))

    expect(atCap).toHaveLength(MAX_PICKS + 1)
    const refused = appendSteps(atCap, [pick(false, post(MAX_PICKS))])
    expect(typeof refused).toBe("string")
    expect(refused).toContain("filter")
    // A select-all starts again, so it is never refused.
    expect(appendSteps(atCap, [rule(true)])).toEqual([rule(true)])
  })

  it("refuses past the rule cap", () => {
    const rules = Array.from({ length: MAX_RULES - 1 }, () =>
      rule(false, arabic),
    )
    const atCap = steps(appendSteps(DEFAULT_SELECTION, rules))

    expect(typeof appendSteps(atCap, [rule(true, arabic)])).toBe("string")
  })
})

describe("runPicks", () => {
  const loaded = [post(1), post(2), post(3), post(4)]

  it("picks the clicked Post alone without shift", () => {
    expect(runPicks(loaded, post(3), false, null)).toEqual([
      pick(false, post(3)),
    ])
  })

  it("picks every loaded Post from the last click to this one, either way", () => {
    expect(runPicks(loaded, post(4), true, "chan:2")).toEqual(
      [2, 3, 4].map((id) => pick(true, post(id))),
    )
    expect(runPicks(loaded, post(1), false, "chan:3")).toEqual(
      [1, 2, 3].map((id) => pick(false, post(id))),
    )
  })

  it("a last click no longer loaded makes it a plain click", () => {
    expect(runPicks(loaded, post(2), true, "chan:99")).toEqual([
      pick(true, post(2)),
    ])
  })
})

describe("selectionChips", () => {
  it("reads in order, a rule each and a run of Picks as one", () => {
    const list = steps(
      appendSteps(DEFAULT_SELECTION, [
        rule(false, arabic),
        pick(false, post(1)),
        pick(false, post(2)),
        pick(false, post(3)),
        pick(true, post(4)),
      ]),
    )

    expect(selectionChips(list).map((c) => c.label)).toEqual([
      "Select all",
      "Deselect Arabic",
      "−3 posts",
      "+1 post",
    ])
  })

  it("names a keyword, a cap and a tree it cannot shorten", () => {
    const snapshot = snapshotOf({
      filter: addPostFunnel(
        addPostFunnel(emptyPostFilter(), "language", "fa"),
        "media",
        "photo",
      ),
      keyword: " tehran ",
      sort: "newest",
      viewMeasure: "estimated",
      maxPerChannel: 5,
      maxPerChannelMode: "random",
      seed: 7,
    })

    expect(selectionChips([rule(true, snapshot)])[0].label).toBe(
      "Select lang:fa and media:photo · “tehran” · 5 random per Channel",
    )
  })

  it("removes one chip's steps and nothing else", () => {
    const list = steps(
      appendSteps(DEFAULT_SELECTION, [
        pick(false, post(1)),
        pick(false, post(2)),
        rule(false, arabic),
      ]),
    )
    const [, picks] = selectionChips(list)

    expect(removeChip(list, picks)).toEqual([
      DEFAULT_SELECTION[0],
      rule(false, arabic),
    ])
    expect(removeChip(list, selectionChips(list)[0])).toHaveLength(3)
  })
})

describe("selectionBody", () => {
  it("sends a rule's empty tree as null and a Pick as it is", () => {
    const body = selectionBody([
      rule(true, { ...EMPTY_SNAPSHOT, tree: emptyPostFilter() }),
      rule(false, arabic),
      pick(true, post(9)),
    ])

    expect(body[0]).toEqual(rule(true))
    expect(body[1]).toEqual(rule(false, arabic))
    expect(body[2]).toEqual({
      kind: "pick",
      select: true,
      channelName: "chan",
      postId: 9,
    })
  })
})

describe("session persistence", () => {
  const tokenFor = (sub: string) =>
    `e30.${btoa(JSON.stringify({ sub })).replaceAll("=", "")}.sig`
  const signIn = (sub: string) =>
    localStorage.setItem("access_token", tokenFor(sub))

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it("keeps one selection per Account, for the session", () => {
    const mine = steps(appendSteps(DEFAULT_SELECTION, [pick(false, post(1))]))
    signIn("alice")
    saveSelection(mine)

    expect(
      sessionStorage.getItem(`u:alice:${SELECTION_STORAGE_KEY}`),
    ).not.toBeNull()
    expect(localStorage.getItem(`u:alice:${SELECTION_STORAGE_KEY}`)).toBeNull()
    expect(loadSelection()).toEqual(mine)

    signIn("bob")
    expect(loadSelection()).toEqual(DEFAULT_SELECTION)

    signIn("alice")
    expect(loadSelection()).toEqual(mine)
  })

  it("starts from the default when what is stored is not a selection", () => {
    signIn("alice")
    sessionStorage.setItem(`u:alice:${SELECTION_STORAGE_KEY}`, '[{"kind":"x"}]')

    expect(loadSelection()).toEqual(DEFAULT_SELECTION)
  })
})

// ---- PTR-06 ------------------------------------------------------------------

describe("facetRule", () => {
  it("is that one Condition and nothing of the current filter", () => {
    const { filter, ...made } = facetRule(false, "language", "ar")
    const { tree, ...rest } = filter
    const { tree: _none, ...empty } = EMPTY_SNAPSHOT
    expect(made).toEqual({ kind: "rule", select: false })
    expect(rest).toEqual(empty)
    // The node ids differ; the text form is the tree.
    expect(tree && printPostFilter(tree)).toBe(
      arabic.tree && printPostFilter(arabic.tree),
    )
  })

  it("names the spotlit Channel, whose Posts the rows count", () => {
    const { filter } = facetRule(true, "language", "ar", "chan")
    expect(filter.tree && printPostFilter(filter.tree)).toBe(
      printPostFilter(
        addPostFunnel(
          {
            kind: "group",
            id: "root",
            op: "and",
            children: [
              {
                kind: "atom",
                id: "c",
                cond: { type: "channel", value: "chan" },
              },
            ],
          },
          "language",
          "ar",
        ),
      ),
    )
  })

  it("reads as the value it reaches", () => {
    const list = steps(
      appendSteps(DEFAULT_SELECTION, [facetRule(false, "language", "ar")]),
    )
    expect(selectionChips(list).map((c) => c.label)).toEqual([
      "Select all",
      "Deselect Arabic",
    ])
  })
})

describe("a negated rule", () => {
  const notArabic = { ...rule(false, arabic), not: true }
  const notAll = { ...rule(false), not: true }

  it("reads as everything but what it names", () => {
    const list = steps(appendSteps(DEFAULT_SELECTION, [notArabic]))
    expect(selectionChips(list).at(-1)?.label).toBe("Deselect all but Arabic")
  })

  it("never replaces the steps before it, even over an empty filter", () => {
    const list = steps(appendSteps(DEFAULT_SELECTION, [notAll]))
    expect(list).toEqual([...DEFAULT_SELECTION, notAll])
  })

  it("travels with its flag, and a plain rule without one", () => {
    expect(selectionBody([notArabic])[0]).toMatchObject({ not: true })
    expect("not" in selectionBody([rule(false, arabic)])[0]).toBe(false)
  })
})

describe("the Venn over Posts", () => {
  const F = arabic
  const keep = (hidden: boolean, both: boolean, fresh: boolean) => ({
    hidden,
    both,
    fresh,
  })

  it("maps each preset to the rules the spec names", () => {
    // Add shown: select F.
    expect(regionSteps(keep(true, true, true), F)).toEqual([rule(true, F)])
    // Remove shown: deselect F.
    expect(regionSteps(keep(true, false, false), F)).toEqual([rule(false, F)])
    // Keep only shown: deselect NOT F.
    expect(regionSteps(keep(false, true, false), F)).toEqual([
      { ...rule(false, F), not: true },
    ])
    // Select only shown: deselect all, then select F.
    expect(regionSteps(keep(false, true, true), F)).toEqual([
      rule(false),
      rule(true, F),
    ])
  })

  it("records nothing for the picture that changes nothing", () => {
    expect(regionSteps(keep(true, true, false), F)).toEqual([])
  })

  it("refuses the picture that would flip each shown Post", () => {
    expect(isExpressible(keep(true, false, true))).toBe(false)
    expect(isExpressible(keep(false, false, true))).toBe(false)
    expect(isExpressible(keep(true, true, true))).toBe(true)
    expect(isExpressible(keep(false, false, false))).toBe(true)
    expect(() => regionSteps(keep(true, false, true), F)).toThrow()
  })

  it("counts the three regions from the server's counts", () => {
    expect(regionCounts({ selected: 10, selectedShown: 4, shown: 7 })).toEqual({
      hidden: 6,
      both: 4,
      fresh: 3,
    })
  })
})
