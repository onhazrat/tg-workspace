/**
 * An Artifact's record said in words (CW-02): History's pill, the re-check
 * now, and when Regenerate is offered.
 */
import { describe, expect, test } from "bun:test"

import { nowPhrase, offersRegenerate, pillPhrase } from "./record"
import { verdict } from "./verdict-fixtures"
import type { Verdict } from "./window-check"

const v = (name: string, over: Partial<Verdict> = {}) =>
  verdict(name, {
    reasons: ["hole"],
    reason: "hole",
    missingIds: 2,
    heldPosts: 3,
    unprovenPosts: 2,
    ...over,
  })
const frozen = v("ice", {
  reasons: ["frozen"],
  reason: "frozen",
  syncable: false,
})
const mark = (unprovenPosts: number, unprovenFloor = false) => ({
  unprovenPosts,
  unprovenFloor,
  fixable: true,
  incompleteCount: 1,
  channelCount: 3,
  counts: {},
})

describe("History's pill", () => {
  test("says the Unproven Posts, a floor with +", () => {
    expect(pillPhrase(mark(6))).toBe("~6 Posts unproven")
    expect(pillPhrase(mark(1))).toBe("~1 Post unproven")
    expect(pillPhrase(mark(40, true))).toBe("~40+ Posts unproven")
    expect(pillPhrase(mark(0))).toBe("no Posts expected")
    expect(pillPhrase(mark(0, true))).toBe(
      "an unknown number of Posts unproven",
    )
  })
})

describe("the window checked again now", () => {
  test("says what is still missing, or that it is complete now", () => {
    expect(nowPhrase([v("a"), v("b")])).toBe("now 2 holes")
    expect(nowPhrase([])).toBe("complete now")
  })

  test("offers Regenerate when a sync can change the answer, never on a Chat", () => {
    expect(offersRegenerate("summary", [v("a"), frozen])).toBe(true)
    expect(offersRegenerate("summary", [])).toBe(true)
    expect(offersRegenerate("tag", [frozen])).toBe(false)
    expect(offersRegenerate("chat", [v("a")])).toBe(false)
  })
})
