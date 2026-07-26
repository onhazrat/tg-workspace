import { describe, expect, it } from "bun:test"
import {
  syncScheduleDetail,
  syncScheduleSummary,
} from "./sync-schedule-summary"

const HOUR = 60 * 60 * 1000

describe("syncScheduleSummary", () => {
  it("uses relative times so the line fits the card", () => {
    expect(
      syncScheduleSummary({
        regularSyncEnabled: true,
        nextRegularSyncAt: Date.now() + 3 * HOUR,
        dynamicSyncEnabled: false,
      }),
    ).toBe("Regular in 3h · Dynamic off")
  })

  /**
   * The regression guard for A7: the old line interpolated two full
   * `toLocaleString()` timestamps and was ~52 chars, well past what 220px of
   * 9px type can show, so every card clipped and the Dynamic half was invisible.
   */
  it("stays short enough to fit the card's fixed width", () => {
    const worstCase = syncScheduleSummary({
      regularSyncEnabled: true,
      nextRegularSyncAt: Date.now() + 240 * HOUR,
      dynamicSyncEnabled: true,
      nextDynamicSyncAt: Date.now() + 240 * HOUR,
    })
    expect(worstCase.length).toBeLessThanOrEqual(32)
    expect(worstCase).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })

  it("defaults regular sync to enabled when the flag is absent", () => {
    expect(syncScheduleSummary({ nextRegularSyncAt: null })).toBe(
      "Regular not scheduled · Dynamic off",
    )
  })

  it("distinguishes off from not scheduled", () => {
    expect(
      syncScheduleSummary({
        regularSyncEnabled: false,
        dynamicSyncEnabled: true,
        nextDynamicSyncAt: null,
      }),
    ).toBe("Regular off · Dynamic not scheduled")
  })
})

describe("syncScheduleDetail", () => {
  it("keeps absolute timestamps for the tooltip, which has room", () => {
    const at = Date.now() + 3 * HOUR
    const detail = syncScheduleDetail({
      regularSyncEnabled: true,
      nextRegularSyncAt: at,
      dynamicSyncEnabled: false,
    })
    expect(detail).toContain(new Date(at).toLocaleString())
    expect(detail).toContain("Dynamic off")
  })
})
