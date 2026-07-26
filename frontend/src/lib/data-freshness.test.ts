import { describe, expect, it } from "bun:test"
import { isStaleCalculation, STALE_AFTER_MS } from "./data-freshness"

const NOW = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1000

describe("isStaleCalculation", () => {
  /** The audit's case: `Last calculated: 5d ago`, shown as if current. */
  it("flags a five-day-old calculation", () => {
    expect(isStaleCalculation(NOW - 5 * DAY, NOW)).toBe(true)
  })

  it("does not flag a fresh calculation", () => {
    expect(isStaleCalculation(NOW - 60_000, NOW)).toBe(false)
  })

  it("treats a never-calculated value as not stale", () => {
    // There is no figure on screen to mislead about.
    expect(isStaleCalculation(null, NOW)).toBe(false)
    expect(isStaleCalculation(undefined, NOW)).toBe(false)
    expect(isStaleCalculation(0, NOW)).toBe(false)
  })

  it("uses a one-day default threshold, exclusive at the boundary", () => {
    expect(STALE_AFTER_MS).toBe(DAY)
    expect(isStaleCalculation(NOW - DAY, NOW)).toBe(false)
    expect(isStaleCalculation(NOW - DAY - 1, NOW)).toBe(true)
  })

  it("accepts a custom threshold", () => {
    expect(isStaleCalculation(NOW - 2000, NOW, 1000)).toBe(true)
    expect(isStaleCalculation(NOW - 500, NOW, 1000)).toBe(false)
  })
})
