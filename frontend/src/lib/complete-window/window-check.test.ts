/**
 * The live check said in words (CW-01): the one line, each row's words, the
 * rows' grouping and order, and the legend's toggles.
 */
import { describe, expect, test } from "bun:test"
import { verdict as base } from "./verdict-fixtures"
import {
  initiallyHidden,
  isolated,
  measure,
  postsPhrase,
  rowGroups,
  shortfall,
  toggled,
  type Verdict,
  type WindowCheck,
} from "./window-check"

const HOUR = 3_600_000
const E = Date.UTC(2026, 9, 30, 9, 7)

const verdict = (name: string, over: Partial<Verdict> = {}) =>
  base(name, { lastSync: E - HOUR, headReadAt: E - HOUR, ...over })

const lagging = (name: string, hours: number, over: Partial<Verdict> = {}) =>
  verdict(name, {
    reasons: ["end"],
    reason: "end",
    stretches: [{ kind: "end", from: E - hours * HOUR, to: E }],
    unprovenPosts: hours,
    ...over,
  })

const frozen = (name: string, posts = 0) =>
  lagging(name, 31, {
    reasons: ["end", "frozen"],
    syncable: false,
    unprovenPosts: posts,
  })

const holed = (name: string, missing: number) =>
  verdict(name, {
    reasons: ["hole"],
    reason: "hole",
    missingIds: missing,
    unprovenPosts: missing,
    stretches: [
      {
        kind: "hole",
        from: Date.UTC(2026, 9, 29, 19, 13),
        to: Date.UTC(2026, 9, 29, 19, 30),
      },
    ],
  })

function check(channels: Verdict[], over: Partial<WindowCheck> = {}) {
  return {
    frozenAt: E,
    start: E - 24 * HOUR,
    end: E,
    channels,
    heldPosts: 4_440,
    unprovenPosts: 185,
    unprovenFloor: false,
    ...over,
  }
}

describe("the one line", () => {
  test("names problems by kind, then routine lag as one phrase", () => {
    const line = measure([
      frozen("a"),
      frozen("b"),
      holed("c", 4),
      lagging("d", 18, { behind: true }),
      lagging("e", 2, { behind: true }),
      lagging("f", 30),
    ])
    expect(line).toBe("2 frozen · 1 hole · 1 overdue · last 18 h on 2")
  })

  test("weighs the window in Posts, with its share of what is held", () => {
    expect(postsPhrase(check([]))).toBe("~185 Posts (4%)")
    expect(
      postsPhrase(check([], { unprovenPosts: 80, unprovenFloor: true })),
    ).toBe("~80+ Posts (2%)")
  })

  test("says no Posts expected only when every pace is known", () => {
    expect(postsPhrase(check([], { unprovenPosts: 0 }))).toBe(
      "no Posts expected",
    )
    expect(
      postsPhrase(check([], { unprovenPosts: 0, unprovenFloor: true })),
    ).toBe("an unknown number of Posts")
  })
})

describe("a row's words", () => {
  test("lag at its own pace, a hole by its ids, a late history", () => {
    expect(shortfall(lagging("a", 31, { pacePerHour: 114 / 31 }))).toBe(
      "31 h behind, ~114 posts",
    )
    expect(shortfall(holed("b", 4))).toMatch(
      /^hole: 4 posts, \d\d:13 [AP]M to \d\d:30 [AP]M$/,
    )
    expect(
      shortfall(
        verdict("c", {
          reasons: ["start"],
          stretches: [{ kind: "start", from: E - 3 * HOUR, to: E - HOUR }],
        }),
      ),
    ).toBe("history starts 2 h late")
  })

  test("an unknown pace says no count, and a never-read Channel says so", () => {
    expect(shortfall(lagging("a", 5, { pacePerHour: null }))).toBe("5 h behind")
    expect(
      shortfall(lagging("b", 5, { lastSync: null, headReadAt: null })),
    ).toBe("never synced")
  })
})

describe("Details", () => {
  const all = check([
    verdict("ok"),
    frozen("asleep", 0),
    frozen("busy", 40),
    holed("holed", 4),
    lagging("lag", 2, { behind: true }),
    lagging("late", 30),
  ])

  test("rows group by what a sync fixes, most Posts at risk first", () => {
    const groups = rowGroups(all, new Set())
    expect(groups.fixable.map((c) => c.name)).toEqual(["late", "holed", "lag"])
    expect(groups.stuck.map((c) => c.name)).toEqual(["busy", "asleep"])
    expect(groups.complete.map((c) => c.name)).toEqual(["ok"])
  })

  test("opens with Behind and Complete off when anything else is there", () => {
    expect([...initiallyHidden(all)].sort()).toEqual(["behind", "complete"])
    const onlyLag = check([verdict("ok"), lagging("lag", 2, { behind: true })])
    expect([...initiallyHidden(onlyLag)]).toEqual(["complete"])
  })

  test("a click toggles a kind; a double-click isolates it, again restores", () => {
    const present = ["hole", "overdue", "stuck"] as const
    const off = toggled(new Set(), "hole")
    expect(rowGroups(all, off).fixable.map((c) => c.name)).toEqual([
      "late",
      "lag",
    ])
    const alone = isolated(new Set(), "stuck", [...present])
    expect([...alone].sort()).toEqual(["hole", "overdue"])
    expect([...isolated(alone, "stuck", [...present])]).toEqual([])
  })
})
