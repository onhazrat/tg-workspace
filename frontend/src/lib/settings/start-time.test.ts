import { describe, expect, it } from "bun:test"
import { computeEffectiveGlobalStartTime } from "./start-time"

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-07-01T00:00:00Z")

describe("computeEffectiveGlobalStartTime", () => {
  it("retention mode: now minus the retention window", () => {
    expect(computeEffectiveGlobalStartTime("retention", null, 30, NOW)).toBe(
      NOW - 30 * DAY_MS,
    )
  })

  it("retention mode: zero retention means no limit", () => {
    expect(computeEffectiveGlobalStartTime("retention", null, 0, NOW)).toBe(0)
  })

  it("relative mode: now minus value days", () => {
    expect(computeEffectiveGlobalStartTime("relative", 7, 30, NOW)).toBe(
      NOW - 7 * DAY_MS,
    )
  })

  it("relative mode: falls back to retention when value is missing", () => {
    expect(computeEffectiveGlobalStartTime("relative", null, 30, NOW)).toBe(
      NOW - 30 * DAY_MS,
    )
    expect(computeEffectiveGlobalStartTime("relative", null, 0, NOW)).toBe(0)
  })

  it("relative mode: clamps to the retention window", () => {
    expect(computeEffectiveGlobalStartTime("relative", 60, 30, NOW)).toBe(
      NOW - 30 * DAY_MS,
    )
  })

  it("absolute mode: parses the date string", () => {
    const date = "2026-06-20T00:00:00Z"
    expect(computeEffectiveGlobalStartTime("absolute", date, 30, NOW)).toBe(
      Date.parse(date),
    )
  })

  it("absolute mode: invalid date string falls back to now", () => {
    expect(
      computeEffectiveGlobalStartTime("absolute", "not-a-date", 30, NOW),
    ).toBe(NOW)
  })

  it("absolute mode: non-string value falls back to now", () => {
    expect(computeEffectiveGlobalStartTime("absolute", null, 30, NOW)).toBe(NOW)
    expect(computeEffectiveGlobalStartTime("absolute", 5, 30, NOW)).toBe(NOW)
  })

  it("absolute mode: clamps dates older than the retention window", () => {
    expect(
      computeEffectiveGlobalStartTime(
        "absolute",
        "2020-01-01T00:00:00Z",
        30,
        NOW,
      ),
    ).toBe(NOW - 30 * DAY_MS)
  })

  it("absolute mode: no clamping when retention is disabled", () => {
    const date = "2020-01-01T00:00:00Z"
    expect(computeEffectiveGlobalStartTime("absolute", date, 0, NOW)).toBe(
      Date.parse(date),
    )
  })
})
