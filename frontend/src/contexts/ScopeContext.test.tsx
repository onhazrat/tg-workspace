/**
 * The controller's React half (AW-03): drafts, the 400 ms commit, and a clock
 * that somebody else owns.
 *
 * The propagation matrix lives in `lib/scope/window.test.ts`, which needs no
 * component tree. What is checked here is only what a tree adds — that a
 * half-typed field cannot reach the committed Scope, that the debounce is real,
 * and that a Live window keeps up with a clock this test drives by hand.
 *
 * Assertions read the committed window and the visible field text. Nothing here
 * names an internal update or counts a render.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"

import {
  DRAFT_COMMIT_MS,
  ScopeProvider,
  useScope,
} from "@/contexts/ScopeContext"
import { MINUTE_MS } from "@/lib/analysis-window"
import { DAY_MS, ERRORS, HOUR_MS, WINDOW_STORAGE_KEY } from "@/lib/scope/window"
import { scopedStorage } from "@/lib/storage/scoped"

const NOW = Date.UTC(2026, 8, 11, 14, 30)

/** Long enough that a timer, had one been armed, would have fired by now. */
const TICK_SETTLE = 1200

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * A clock the test moves. Nothing in the controller may read another one.
 *
 * It reports an *instant*, not the minute it falls in, because the live timer
 * (AW-04) waits out the rest of the current minute and a pre-floored clock
 * cannot say how much of it is left.
 */
function fakeClock(instant = NOW) {
  let now = instant
  return {
    read: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

/**
 * A clock `ms` short of the next minute boundary, so the tick the provider arms
 * arrives in test time rather than in a real minute of it. It still *floors* to
 * `NOW`, so every assertion about the window reads the same as elsewhere.
 */
const clockNearBoundary = (ms: number) => fakeClock(NOW + MINUTE_MS - ms)

let documentHidden = false

Object.defineProperty(document, "hidden", {
  configurable: true,
  get: () => documentHidden,
})

function setHidden(hidden: boolean) {
  documentHidden = hidden
  document.dispatchEvent(new Event("visibilitychange"))
}

function mount(clock: () => number) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ScopeProvider clock={clock}>{children}</ScopeProvider>
  )
  return renderHook(() => useScope(), { wrapper })
}

beforeEach(() => {
  localStorage.clear()
})

// The live timer outlives the test that armed it otherwise, and fires into the
// next one's provider outside `act`.
afterEach(() => {
  cleanup()
  documentHidden = false
})

describe("the injected clock is the only clock", () => {
  test("a new Account starts on a 24-hour Live window ending now", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    expect(result.current.mode).toBe("live")
    expect(result.current.endDate).toBe(NOW)
    expect(result.current.startDate).toBe(NOW - DAY_MS)
    expect(result.current.summary).toBe("Live · 1d ago → now (1d)")
  })

  test("the clock is read, not `Date.now`", () => {
    const read = mock(() => NOW)
    mount(read)

    expect(read).toHaveBeenCalled()
  })
})

describe("drafts are separate from the committed window", () => {
  test("a field shows the committed value until something is typed", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    expect(result.current.draftText("duration")).toBe("1d")

    act(() => result.current.setDraft("duration", "3h"))

    expect(result.current.draftText("duration")).toBe("3h")
  })

  test("a valid draft commits itself after 400 ms without input", async () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => result.current.setDraft("duration", "3h"))
    expect(result.current.startDate).toBe(NOW - DAY_MS)

    // Still uncommitted well into the wait — otherwise every keystroke would
    // reach the feed, and "1" on the way to "12h" is its own valid window.
    await act(() => settle(DRAFT_COMMIT_MS / 2))
    expect(result.current.startDate).toBe(NOW - DAY_MS)

    await waitFor(() =>
      expect(result.current.startDate).toBe(NOW - 3 * HOUR_MS),
    )
    expect(result.current.draftText("duration")).toBe("3h")
  })

  test("a keystroke restarts the wait rather than committing a prefix", async () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => result.current.setDraft("duration", "3"))
    act(() => result.current.setDraft("duration", "3h"))

    await waitFor(() =>
      expect(result.current.startDate).toBe(NOW - 3 * HOUR_MS),
    )
    // `3` alone is not a legal value; had the first timer survived it would
    // have left an error behind.
    expect(result.current.errors.duration).toBeUndefined()
  })

  test("Enter or blur commits immediately", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => {
      result.current.setDraft("duration", "3h")
      result.current.commitDraft("duration")
    })

    expect(result.current.startDate).toBe(NOW - 3 * HOUR_MS)
  })

  test("an invalid draft shows an error and leaves the window alone", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => {
      result.current.setDraft("duration", "half a day")
      result.current.commitDraft("duration")
    })

    expect(result.current.errors.duration).toBe(ERRORS.grammar)
    expect(result.current.startDate).toBe(NOW - DAY_MS)
    expect(result.current.draftText("duration")).toBe("half a day")
  })

  test("closing the editor throws every draft away, errors included", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => {
      result.current.setDraft("duration", "half a day")
      result.current.commitDraft("duration")
      result.current.discardDrafts()
    })

    expect(result.current.errors.duration).toBeUndefined()
    expect(result.current.draftText("duration")).toBe("1d")
    expect(result.current.startDate).toBe(NOW - DAY_MS)
  })
})

describe("committed changes", () => {
  test("a mode switch changes none of the four values at that instant", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)
    const before = {
      startDate: result.current.startDate,
      endDate: result.current.endDate,
      durationMs: result.current.durationMs,
      endGapMs: result.current.endGapMs,
    }

    act(() => result.current.setMode("fixed"))

    expect(result.current.mode).toBe("fixed")
    expect({
      startDate: result.current.startDate,
      endDate: result.current.endDate,
      durationMs: result.current.durationMs,
      endGapMs: result.current.endGapMs,
    }).toEqual(before)
  })

  test("a restored Scope arrives as Fixed", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => result.current.setFixedRange(NOW - DAY_MS, NOW - HOUR_MS))

    expect(result.current.mode).toBe("fixed")
    expect(result.current.endDate).toBe(NOW - HOUR_MS)
    expect(result.current.endGapMs).toBe(HOUR_MS)
  })

  test("a refused direct value returns the reason and commits nothing", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)
    let refusal: string | null = null

    act(() => {
      refusal = result.current.applyValue("end", NOW + HOUR_MS)
    })

    expect(refusal).toBe(ERRORS.future)
    expect(result.current.endDate).toBe(NOW)
  })

  test("every commit is remembered for the Account", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => {
      result.current.applyValue("duration", 3 * HOUR_MS)
    })

    expect(
      JSON.parse(scopedStorage.getItem(WINDOW_STORAGE_KEY) ?? "null"),
    ).toEqual({ mode: "live", durationMs: 3 * HOUR_MS, endGapMs: 0 })
  })
})

describe("a Live window keeps up with the clock on its own", () => {
  test("the boundaries advance at the minute boundary", async () => {
    const clock = clockNearBoundary(150)
    const { result } = mount(clock.read)

    expect(result.current.endDate).toBe(NOW)

    act(() => clock.advance(150))
    await act(() => settle(TICK_SETTLE))

    expect(result.current.endDate).toBe(NOW + MINUTE_MS)
    expect(result.current.startDate).toBe(NOW + MINUTE_MS - DAY_MS)
    expect(result.current.liveTick).toBeGreaterThan(0)
  })

  test("the key the feed is built on does not move with them", async () => {
    const clock = clockNearBoundary(150)
    const { result } = mount(clock.read)
    const before = result.current.windowKey

    act(() => clock.advance(150))
    await act(() => settle(TICK_SETTLE))

    expect(result.current.endDate).toBe(NOW + MINUTE_MS)
    // This is the whole reason the tick is an invalidation rather than a new
    // key: a Live window's *identity* — 24 hours ending at the current minute —
    // is what `queryKeys.postsFeed` is built from, and it did not change. A key
    // carrying the resolved pair would remint every minute, remount the
    // infinite feed at page one and throw away the Account's scroll.
    expect(result.current.windowKey).toEqual(before)
    expect(result.current.windowKey).toEqual({
      mode: "live",
      durationMs: DAY_MS,
      endGapMs: 0,
    })
  })

  test("a Fixed window keeps still, but its End gap keeps up", async () => {
    const clock = clockNearBoundary(150)
    const { result } = mount(clock.read)

    act(() => result.current.setMode("fixed"))
    act(() => clock.advance(150))
    await act(() => settle(TICK_SETTLE))

    // The boundaries are stored, so nothing moves them and nothing needs
    // refetching — a Fixed window selects the same Posts however long you look.
    expect(result.current.endDate).toBe(NOW)
    expect(result.current.startDate).toBe(NOW - DAY_MS)
    expect(result.current.liveTick).toBe(0)

    // End gap is *derived* from the current minute, though. Freezing it would
    // show `0m` on a page left open for three hours past a window that ended.
    expect(result.current.endGapMs).toBe(MINUTE_MS)
    expect(result.current.draftText("endGap")).toBe("1m")
  })

  test("a tick that finds the minute unmoved refreshes nothing", async () => {
    const clock = clockNearBoundary(150)
    const { result } = mount(clock.read)

    // The clock never reaches the next minute. The timer still fires — it is
    // counting this browser's milliseconds against a delay computed from the
    // server's estimate — and re-arms for the remainder each time.
    await act(() => settle(TICK_SETTLE))

    expect(result.current.endDate).toBe(NOW)
    expect(result.current.liveTick).toBe(0)
  })

  test("the tick is suspended while the document is hidden", async () => {
    setHidden(true)
    const clock = clockNearBoundary(150)
    const { result } = mount(clock.read)

    act(() => clock.advance(150))
    await act(() => settle(TICK_SETTLE))

    expect(result.current.endDate).toBe(NOW)
    expect(result.current.liveTick).toBe(0)
  })

  test("regaining focus catches up immediately, without waiting for a boundary", () => {
    documentHidden = true
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => clock.advance(3 * MINUTE_MS))
    expect(result.current.endDate).toBe(NOW)

    act(() => setHidden(false))

    // Not at the next boundary — now. A tab that has been away is stale the
    // moment it comes back, and `liveTick` is what refreshes the feed with it.
    expect(result.current.endDate).toBe(NOW + 3 * MINUTE_MS)
    expect(result.current.liveTick).toBe(1)
  })

  test("a commit re-reads the clock, so Live catches up the moment it matters", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => clock.advance(5 * MINUTE_MS))
    act(() => {
      result.current.applyValue("duration", 3 * HOUR_MS)
    })

    expect(result.current.endDate).toBe(NOW + 5 * MINUTE_MS)
    expect(result.current.startDate).toBe(NOW + 5 * MINUTE_MS - 3 * HOUR_MS)
  })

  test("a Fixed window does not move when a later commit re-reads the clock", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => result.current.setMode("fixed"))
    act(() => clock.advance(5 * MINUTE_MS))
    act(() => {
      result.current.applyValue("duration", 3 * HOUR_MS)
    })

    expect(result.current.endDate).toBe(NOW)
    expect(result.current.endGapMs).toBe(5 * MINUTE_MS)
  })

  test("a refused value reaches the field's own error, not just the caller", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => {
      result.current.applyValue("end", NOW + HOUR_MS)
    })

    expect(result.current.errors.end).toBe(ERRORS.future)

    // And a success on another field leaves that refusal standing, because the
    // stale value is still in the End input.
    act(() => {
      result.current.applyValue("duration", 3 * HOUR_MS)
    })

    expect(result.current.errors.end).toBe(ERRORS.future)
    expect(result.current.errors.duration).toBeUndefined()
  })

  test("a draft committed later is measured against the minute it lands in", async () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => result.current.setDraft("endGap", "5m"))
    act(() => clock.advance(3 * MINUTE_MS))

    await waitFor(() =>
      expect(result.current.endDate).toBe(NOW + 3 * MINUTE_MS - 5 * MINUTE_MS),
    )
  })
})

describe("one tab does not disturb another", () => {
  test("a storage event from another tab changes nothing here", () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: WINDOW_STORAGE_KEY,
          newValue: JSON.stringify({
            mode: "fixed",
            start: NOW - HOUR_MS,
            end: NOW,
          }),
        }),
      )
    })

    // The other tab's write decides where a future *reload* starts, and
    // nothing more. Subscribing to it would make this tab's work jump.
    expect(result.current.mode).toBe("live")
    expect(result.current.durationMs).toBe(DAY_MS)
  })
})
