import { describe, expect, it } from "bun:test"
import { fixedWindow, floorToMinute, MINUTE_MS } from "./analysis-window"

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

const MINUTE = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS

describe("floorToMinute", () => {
  it("drops seconds and milliseconds", () => {
    expect(floorToMinute(MINUTE + 59_999)).toBe(MINUTE)
    expect(floorToMinute(MINUTE)).toBe(MINUTE)
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
    const start = MINUTE - 60 * MINUTE_MS + 31_500
    const end = MINUTE - MINUTE_MS + 999

    expect(fixedWindow(start, end)).toEqual({
      mode: "fixed",
      start: MINUTE - 60 * MINUTE_MS,
      end: MINUTE - MINUTE_MS,
    })
  })

  it("holds an end the browser put in the future to the current minute", () => {
    // What a clock running four minutes fast produces for "up to now". Sent
    // as-is this is a 422 — the server refuses a Fixed end it has not reached
    // — so every such browser would lose the feed entirely.
    const window = fixedWindow(MINUTE - MINUTE_MS, MINUTE + 4 * MINUTE_MS)

    expect(window).toEqual({
      mode: "fixed",
      start: MINUTE - MINUTE_MS,
      end: MINUTE,
    })
  })

  it("treats one open side as reaching the corpus edge, not as no window", () => {
    // The old pair let either side be absent. Both cases select the same rows
    // as leaving the side open did: nothing is stored before the epoch, and
    // nothing is stored in the future.
    expect(fixedWindow(MINUTE - MINUTE_MS, undefined)).toEqual({
      mode: "fixed",
      start: MINUTE - MINUTE_MS,
      end: MINUTE,
    })
    expect(fixedWindow(undefined, MINUTE - MINUTE_MS)).toEqual({
      mode: "fixed",
      start: 0,
      end: MINUTE - MINUTE_MS,
    })
  })
})
