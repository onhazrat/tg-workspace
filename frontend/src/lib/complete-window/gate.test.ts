/**
 * The gate's rules (CW-02): its title, what the check at the click asks of
 * it, each control's effect on the list, how its Sync covers the syncs in
 * flight, and what each choice records.
 */
import { describe, expect, test } from "bun:test"

import {
  afterWait,
  canUnfreeze,
  gateTitle,
  leaveOut,
  outcomeOf,
  rowProgress,
  setGateOutcome,
  syncedSaid,
  syncPlan,
  takeGateOutcome,
  unfrozen,
  verdictOf,
  walkBack,
  withEdits,
} from "./gate"
import { verdict, windowCheck } from "./verdict-fixtures"
import type { Verdict } from "./window-check"

const E = Date.UTC(2026, 9, 30, 8, 43)

/** Incomplete for its end, unless `over` says otherwise. */
const v = (name: string, over: Partial<Verdict> = {}) =>
  verdict(name, { reasons: ["end"], reason: "end", unprovenPosts: 2, ...over })
const complete = (name: string) => verdict(name)
const check = (channels: Verdict[]) => windowCheck(channels, { end: E })
const frozen = v("ice", {
  reasons: ["end", "frozen"],
  reason: "end",
  syncable: false,
})

describe("the title", () => {
  test("counts what needs attention apart from what is just behind", () => {
    const behind = Array.from({ length: 150 }, (_, i) =>
      v(`b${i}`, { behind: true }),
    )
    const problems = Array.from({ length: 23 }, (_, i) => v(`p${i}`))
    expect(gateTitle([...problems, ...behind])).toBe(
      "23 Channels need attention, 150 just behind",
    )
    expect(gateTitle([v("one")])).toBe("1 Channel needs attention")
    expect(gateTitle(behind.slice(0, 2))).toBe("2 Channels are just behind")
  })
})

describe("the check frozen at the click", () => {
  test("runs at once when nothing is Incomplete or nothing is fixable", () => {
    expect(verdictOf(check([complete("a")]))).toBe("complete")
    expect(verdictOf(check([complete("a"), frozen]))).toBe("nothing_to_sync")
    expect(verdictOf(check([frozen, v("lag")]))).toBe("review")
  })

  test("keeps the gate's edits when it replaces the cached one", () => {
    const edited = withEdits(check([v("a"), frozen, v("gone")]), {
      leftOut: ["gone"],
      unfrozen: ["ice"],
    })
    expect(edited.channels.map((c) => [c.name, c.syncable])).toEqual([
      ["a", true],
      ["ice", true],
    ])
  })
})

describe("the controls", () => {
  test("Unfreeze is offered on a frozen row Telegram serves, and moves it", () => {
    const gone = v("gone", {
      reasons: ["frozen", "unavailable"],
      syncable: false,
    })
    expect([canUnfreeze(frozen), canUnfreeze(gone)]).toEqual([true, false])
    expect(unfrozen(frozen)).toMatchObject({
      reasons: ["end"],
      reason: "end",
      syncable: true,
    })
  })

  test("Leave out takes the rows out of the check", () => {
    expect(
      leaveOut(check([v("a"), frozen]), ["ice"]).channels.map((c) => c.name),
    ).toEqual(["a"])
  })
})

describe("the Sync over the syncs in flight", () => {
  test("joins one that reads its head after E, queues behind one that read it before", () => {
    const wanted = [
      v("joined", { syncingSince: E - 1 }),
      v("behind", { syncingSince: E - 1, syncAgain: true }),
      v("idle"),
    ]
    expect(syncPlan(wanted)).toEqual({
      join: ["joined"],
      after: ["behind"],
      atOnce: ["idle"],
    })
  })

  test("walks back to the Start only where history is short or holed", () => {
    const wanted = [
      v("short", { reasons: ["start"] }),
      v("holed", { reasons: ["end", "hole"] }),
      v("lag"),
    ]
    expect(walkBack(wanted, E - 9)).toEqual({ short: E - 9, holed: E - 9 })
  })
})

describe("each row while the gate syncs", () => {
  const at = { own: true, scraping: false, seen: false, now: E }
  test("its own sync spins, then says synced; queued before it starts", () => {
    expect(rowProgress(v("a"), { ...at, scraping: true })).toEqual({
      spin: true,
      text: "",
    })
    expect(rowProgress(v("a"), at)?.text).toBe("queued")
    expect(rowProgress(v("a"), { ...at, seen: true })?.text).toBe("synced")
  })

  test("another's sync says when it started, and whether one follows", () => {
    const flying = v("b", { syncingSince: E - 2 * 60_000 })
    expect(rowProgress(flying, { ...at, own: false })?.text).toBe(
      "syncing, started 2 min ago",
    )
    expect(
      rowProgress({ ...flying, syncAgain: true }, { ...at, own: false })?.text,
    ).toBe("syncing, started 2 min ago, another to follow")
    expect(rowProgress(v("c"), { ...at, own: false })).toBeNull()
  })
})

describe("what the record is sent", () => {
  test("a skip names the Channels a sync could have fixed", () => {
    expect(outcomeOf("skipped", E, check([v("lag"), frozen]))).toEqual({
      choice: "skipped",
      frozenAt: E,
      skipped: ["lag"],
      timedOut: [],
      leftOut: [],
    })
    expect(
      outcomeOf("complete_only", E, check([v("lag")]), { leftOut: ["lag"] }),
    ).toMatchObject({ skipped: [], leftOut: ["lag"] })
  })

  test("the outcome is taken once, by the submission the gate ran", () => {
    setGateOutcome(outcomeOf("complete", E, undefined))
    expect(takeGateOutcome()?.choice).toBe("complete")
    expect(takeGateOutcome()).toBeUndefined()
  })

  test("the toast says what the sync achieved", () => {
    const wanted = Array.from({ length: 165 }, (_, i) => `c${i}`)
    const still = wanted.slice(0, 5).map((n) => v(n))
    expect(syncedSaid(wanted, still)).toBe(
      "Synced 165: 160 now complete, 5 still not",
    )
    expect(syncedSaid(["a"], [])).toBe("Synced 1: 1 now complete")
  })

  test("Leave out's Channels join the Left out of the record", () => {
    expect(
      outcomeOf("skipped", E, check([v("lag")]), {}, ["ice"]).leftOut,
    ).toEqual(["ice"])
  })
})

describe("how the gate's wait ended", () => {
  // `a` still syncing, `b` synced but still Incomplete, `c` now Complete.
  const again = check([
    v("a", { syncingSince: E }),
    v("b", { reasons: ["failed", "end"], reason: "failed" }),
    complete("c"),
  ])

  test("every sync done is synced, whatever is still Incomplete", () => {
    expect(afterWait("synced", ["a", "b", "c"], again)).toEqual({
      choice: "synced",
      timedOut: [],
    })
  })

  test("the deadline times out only what was still syncing", () => {
    expect(afterWait("deadline", ["a", "b", "c"], again)).toEqual({
      choice: "timed_out",
      timedOut: ["a"],
    })
  })

  test("Continue now is continued early, the same Channels timed out", () => {
    expect(afterWait("continued", ["a", "b", "c"], again)).toEqual({
      choice: "continued_early",
      timedOut: ["a"],
    })
  })
})
