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

import { beforeEach, describe, expect, mock, test } from "bun:test"
import { act, renderHook, waitFor } from "@testing-library/react"
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

/** A clock the test moves. Nothing in the controller may read another one. */
function fakeClock() {
  let minute = NOW
  return {
    read: () => minute,
    advance: (ms: number) => {
      minute += ms
    },
  }
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

describe("the window is re-resolved on commits, not on a timer", () => {
  test("nothing reminds the boundaries while the clock runs on", async () => {
    const clock = fakeClock()
    const { result } = mount(clock.read)

    act(() => clock.advance(5 * MINUTE_MS))
    await act(() => settle(TICK_SETTLE))

    // `startDate`/`endDate` are what `queryKeys.postsFeed` is built from. A
    // timer re-resolving them would remint the key every minute, remounting the
    // infinite feed at page one and throwing away the Account's scroll. Moving
    // a Live window is AW-04's, by invalidating the key rather than changing it.
    expect(result.current.startDate).toBe(NOW - DAY_MS)
    expect(result.current.endDate).toBe(NOW)
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
