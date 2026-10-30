/**
 * The gate's rules (CW-02): its title, what the check at the click asks of
 * it, each control's effect on the list, how its Sync joins a banner sync,
 * and what each choice records.
 */
import { describe, expect, test } from "bun:test"

import {
  afterWait,
  canUnfreeze,
  gateTitle,
  leaveOut,
  outcomeOf,
  outcomeToast,
  setGateOutcome,
  syncedSaid,
  syncPlan,
  takeGateOutcome,
  unfrozen,
  verdictOf,
  withReason,
} from "./gate"
import type { Verdict, WindowCheck } from "./window-check"

const E = Date.UTC(2026, 9, 30, 8, 43)

function v(name: string, over: Partial<Verdict> = {}): Verdict {
  return {
    name,
    reasons: ["end"],
    reason: "end",
    lastSync: null,
    headReadAt: null,
    error: null,
    stretches: [],
    missingIds: 0,
    syncable: true,
    behind: false,
    pacePerHour: 1,
    heldPosts: 3,
    unprovenPosts: 2,
    ...over,
  }
}
const complete = (name: string) => v(name, { reasons: [], reason: null })
const check = (channels: Verdict[]): WindowCheck => ({
  frozenAt: E,
  start: E - 3_600_000,
  end: E,
  channels,
  heldPosts: 3,
  unprovenPosts: 6,
  unprovenFloor: false,
})
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

  test("a reason the gate adds is shown first", () => {
    expect(
      withReason(v("a", { reasons: ["end", "hole"] }), "timed_out"),
    ).toMatchObject({
      reasons: ["timed_out", "end", "hole"],
      reason: "timed_out",
    })
  })
})

describe("joining a banner sync", () => {
  const wanted = ["a", "b", "c"]
  test("joins one started at or after E, syncs again after an earlier one", () => {
    const banner = (startedAt: number) => ({
      names: new Set(["a", "b"]),
      startedAt,
    })
    expect(syncPlan(wanted, banner(E), E)).toEqual({
      join: ["a", "b"],
      after: [],
      now: ["c"],
    })
    expect(syncPlan(wanted, banner(E - 1), E)).toEqual({
      join: [],
      after: ["a", "b"],
      now: ["c"],
    })
    expect(syncPlan(wanted, null, E)).toEqual({
      join: [],
      after: [],
      now: wanted,
    })
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
})

describe("how the gate's sync ended", () => {
  test("synced, or continued early with what is still Incomplete timed out", () => {
    const still = [v("a"), v("other")]
    expect(afterWait(true, ["a", "b"], still)).toEqual({
      choice: "synced",
      timedOut: [],
    })
    expect(afterWait(false, ["a", "b"], still)).toEqual({
      choice: "continued_early",
      timedOut: ["a"],
    })
  })

  test("Leave out's Channels join the Left out of the record", () => {
    expect(
      outcomeOf("skipped", E, check([v("lag")]), {}, ["ice"]).leftOut,
    ).toEqual(["ice"])
  })
})

describe("the toast as the action runs", () => {
  test("says what the sync did and what the window still lacks", () => {
    expect(
      outcomeToast(
        "discover",
        "synced",
        check([frozen]),
        "Synced 1: 1 now complete",
      ),
    ).toEqual({
      level: "warning",
      text: "Synced 1: 1 now complete. Generate report runs on an Incomplete window: 1 frozen.",
    })
    expect(
      outcomeToast(
        "summary",
        "synced",
        check([complete("a")]),
        "Synced 1: 1 now complete",
      ),
    ).toEqual({ level: "success", text: "Synced 1: 1 now complete." })
    expect(
      outcomeToast("summary", "nothing_to_sync", check([frozen])),
    ).toMatchObject({
      text: "Generate summary runs on an Incomplete window: 1 frozen.",
    })
  })

  test("says nothing on a Complete window, complete only included", () => {
    expect(outcomeToast("tags", "complete", check([complete("a")]))).toBeNull()
    expect(outcomeToast("tags", "complete_only", check([v("lag")]))).toBeNull()
  })
})
