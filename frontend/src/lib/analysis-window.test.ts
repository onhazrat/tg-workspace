import { describe, expect, it } from "bun:test"
import {
  fixedWindow,
  floorToMinute,
  legalRange,
  MINUTE_MS,
} from "./analysis-window"

/**
 * AW-02, the browser half.
 *
 * The server decides which Posts an operation selects. What is left here is the
 * conversion from the pair the old UI produced to the window the server now
 * expects, and that conversion has two jobs the server cannot do for it: floor
 * to the minute the way the server will, and keep an end the browser computed
 * from its own clock from landing in the server's future.
 *
 * The clock offset itself is not exercised — it is a single `let` set by one
 * network read, and an unsynced offset is zero, which is the browser clock,
 * which is what every assertion below assumes.
 */

/**
 * Read per assertion, never captured once at module load.
 *
 * `fixedWindow` calls `serverMinuteStart()` when the assertion runs, so a
 * fixture frozen at import time is a different minute from the one under test
 * whenever a run crosses a boundary — which is a flake that shows up as an
 * off-by-60000 diff on an unrelated afternoon.
 */
const minute = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS

describe("floorToMinute", () => {
  it("drops seconds and milliseconds", () => {
    const m = minute()

    expect(floorToMinute(m + 59_999)).toBe(m)
    expect(floorToMinute(m)).toBe(m)
  })

  it("floors backwards before the epoch rather than truncating toward it", () => {
    expect(floorToMinute(-1)).toBe(-MINUTE_MS)
  })
})

describe("fixedWindow", () => {
  it("sends nothing when neither boundary is named", () => {
    expect(fixedWindow(undefined, undefined)).toBeUndefined()
  })

  it("floors both boundaries to the minute, as the server will", () => {
    const m = minute()

    expect(
      fixedWindow(m - 60 * MINUTE_MS + 31_500, m - MINUTE_MS + 999),
    ).toEqual({
      mode: "fixed",
      start: m - 60 * MINUTE_MS,
      end: m - MINUTE_MS,
    })
  })

  it("holds an end the browser put in the future to the current minute", () => {
    // What a clock running four minutes fast produces for "up to now". Sent
    // as-is this is a 422 — the server refuses a Fixed end it has not reached
    // — so every such browser would lose the feed entirely.
    const m = minute()
    const window = fixedWindow(m - MINUTE_MS, m + 4 * MINUTE_MS)

    expect(window).toEqual({
      mode: "fixed",
      start: m - MINUTE_MS,
      end: m,
    })
  })

  it("treats one open side as reaching the corpus edge, not as no window", () => {
    // The old pair let either side be absent. Both cases select the same rows
    // as leaving the side open did: nothing is stored before the epoch, and
    // nothing is stored in the future.
    const m = minute()

    expect(fixedWindow(m - MINUTE_MS, undefined)).toEqual({
      mode: "fixed",
      start: m - MINUTE_MS,
      end: m,
    })
    expect(fixedWindow(undefined, m - MINUTE_MS)).toEqual({
      mode: "fixed",
      start: 0,
      end: m - MINUTE_MS,
    })
  })
})

describe("legalRange", () => {
  /**
   * The regression this exists for: every workspace setter used to repair a
   * crossed range by collapsing it onto one instant, and AW-02 turned that
   * empty window into a 422 on the feed, the counts, Discover and every
   * Action at once. The pair is persisted, so a reload did not clear it.
   */
  it("never returns a zero-width range, however the two were crossed", () => {
    const m = minute()

    for (const [start, end] of [
      [m - MINUTE_MS, m - MINUTE_MS], // already collapsed
      [m, m - 5 * MINUTE_MS], // End dragged before Start
      [m - 10, m - 5], // both inside the current minute
      [m + 9 * MINUTE_MS, m + 9 * MINUTE_MS], // both in the future
    ]) {
      const [s, e] = legalRange(start, end)
      expect(e - s).toBeGreaterThanOrEqual(MINUTE_MS)
    }
  })

  it("leaves a range that is already legal alone", () => {
    const m = minute()

    expect(legalRange(m - 60 * MINUTE_MS, m - MINUTE_MS)).toEqual([
      m - 60 * MINUTE_MS,
      m - MINUTE_MS,
    ])
  })

  it("holds the End and moves the Start, per the propagation rule", () => {
    const m = minute()

    // Start dragged past End: the End is what stays put (ADR-018).
    expect(legalRange(m - MINUTE_MS, m - 5 * MINUTE_MS)).toEqual([
      m - 6 * MINUTE_MS,
      m - 5 * MINUTE_MS,
    ])
  })

  it("never lets the End reach past the server's current minute", () => {
    const m = minute()
    const [, end] = legalRange(m - MINUTE_MS, m + 4 * MINUTE_MS)

    expect(end).toBe(m)
  })
})
