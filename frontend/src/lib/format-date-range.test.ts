import { describe, expect, it } from "bun:test"
import { formatDateRange } from "./format-date-range"
import { formatDateToLocalISO } from "./utils"

/**
 * Dates are constructed with local-time components, not from ISO strings: an
 * ISO string with a `Z` would be parsed as UTC and the assertions would then
 * depend on the machine's timezone.
 */
const local = (y: number, m: number, d: number, h: number, min: number): Date =>
  new Date(y, m - 1, d, h, min)

describe("formatDateRange", () => {
  it("never emits the machine format the audit flagged", () => {
    // The exact shape D4 reported, and the reason this module exists.
    const range = formatDateRange(
      local(2026, 7, 24, 23, 54),
      local(2026, 7, 25, 0, 24),
      "en-US",
    )
    expect(range).not.toContain("T")
    expect(range).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it("spells out a range that crosses midnight", () => {
    expect(
      formatDateRange(
        local(2026, 7, 24, 23, 54),
        local(2026, 7, 25, 0, 24),
        "en-US",
      ),
    ).toBe("Jul 24, 2026, 11:54 PM – Jul 25, 2026, 12:24 AM")
  })

  it("states the day once when the range stays inside it", () => {
    expect(
      formatDateRange(
        local(2026, 7, 25, 9, 5),
        local(2026, 7, 25, 17, 30),
        "en-US",
      ),
    ).toBe("Jul 25, 2026, 9:05 AM – 5:30 PM")
  })

  it("treats same day-of-month in different months as different days", () => {
    const range = formatDateRange(
      local(2026, 6, 25, 9, 0),
      local(2026, 7, 25, 9, 0),
      "en-US",
    )
    expect(range).toBe("Jun 25, 2026, 9:00 AM – Jul 25, 2026, 9:00 AM")
  })

  it("treats same day-of-month in different years as different days", () => {
    const range = formatDateRange(
      local(2025, 7, 25, 9, 0),
      local(2026, 7, 25, 9, 0),
      "en-US",
    )
    expect(range).toBe("Jul 25, 2025, 9:00 AM – Jul 25, 2026, 9:00 AM")
  })

  it("honours the locale it is given", () => {
    const range = formatDateRange(
      local(2026, 7, 25, 9, 5),
      local(2026, 7, 25, 17, 30),
      "de-DE",
    )
    // A different locale must actually change the rendering, otherwise the
    // parameter is decorative.
    expect(range).not.toContain("Jul ")
    expect(range).toContain("2026")
  })
})

describe("formatDateToLocalISO is still the input formatter", () => {
  /**
   * `<input type="datetime-local">` only accepts `YYYY-MM-DDTHH:mm`. If someone
   * "humanises" this helper too, every date picker in the app silently stops
   * round-tripping its value — so the machine format is pinned here on purpose.
   */
  it("keeps the exact shape datetime-local requires", () => {
    expect(formatDateToLocalISO(local(2026, 7, 24, 23, 54))).toBe(
      "2026-07-24T23:54",
    )
    expect(formatDateToLocalISO(local(2026, 1, 5, 9, 5))).toBe(
      "2026-01-05T09:05",
    )
  })
})
