import { beforeEach, describe, expect, it } from "bun:test"

import { addPostFunnel, emptyPostFilter } from "./post-filter"
import {
  appendSteps,
  DEFAULT_SELECTION,
  EMPTY_SNAPSHOT,
  loadSelection,
  MAX_PICKS,
  MAX_RULES,
  type PostFilterSnapshot,
  type PostSelection,
  pick,
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
