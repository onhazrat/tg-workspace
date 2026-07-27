import { describe, expect, it } from "bun:test"
import { isEmptyScope, restoredScopeNotice } from "./restored-scope-notice"

const local = (
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
): number => new Date(y, m - 1, d, h, min).getTime()

describe("restoredScopeNotice", () => {
  it("names both things the load changed", () => {
    // Channels and dates are exactly what applyHistorySummarySelection writes,
    // so the notice has to account for both or it is still partly silent.
    const notice = restoredScopeNotice(
      {
        channelCount: 12,
        startDate: local(2026, 7, 24, 23, 54),
        endDate: local(2026, 7, 25, 0, 24),
      },
      "en-US",
    )
    expect(notice).toContain("12 channels")
    expect(notice).toContain("Jul 24, 2026")
    expect(notice).toContain("Jul 25, 2026")
  })

  it("does not say '1 channels'", () => {
    const notice = restoredScopeNotice(
      {
        channelCount: 1,
        startDate: local(2026, 7, 25, 9, 0),
        endDate: local(2026, 7, 25, 17, 0),
      },
      "en-US",
    )
    expect(notice).toContain("1 channel,")
    expect(notice).not.toContain("1 channels")
  })

  it("never shows the machine timestamp", () => {
    // It renders through formatDateRange, so the D4 defect cannot reappear here.
    const notice = restoredScopeNotice(
      {
        channelCount: 3,
        startDate: local(2026, 7, 24, 23, 54),
        endDate: local(2026, 7, 25, 0, 24),
      },
      "en-US",
    )
    expect(notice).not.toContain("T")
    expect(notice).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it("collapses a same-day range to one date", () => {
    const notice = restoredScopeNotice(
      {
        channelCount: 2,
        startDate: local(2026, 7, 25, 9, 5),
        endDate: local(2026, 7, 25, 17, 30),
      },
      "en-US",
    )
    expect(notice).toBe(
      "Scope set to 2 channels, Jul 25, 2026, 9:05 AM – 5:30 PM",
    )
  })

  it("flags a report saved with no channels", () => {
    // Loading one still replaces the selection — with nothing — so this is the
    // case where a bare "Scope set to 0 channels" would be least helpful.
    expect(isEmptyScope({ channelCount: 0, startDate: 0, endDate: 0 })).toBe(
      true,
    )
    expect(isEmptyScope({ channelCount: 1, startDate: 0, endDate: 0 })).toBe(
      false,
    )
  })
})
