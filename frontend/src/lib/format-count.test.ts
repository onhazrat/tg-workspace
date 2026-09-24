import { describe, expect, test } from "bun:test"
import { formatCount } from "./format-count"

/**
 * ADR-023: counters are stored as numbers and shown the way Telegram shows
 * them. The expected strings are what Telegram's own page renders for these
 * counts, so storing the number loses nothing a reader could see.
 *
 * Watched to fail: `maximumFractionDigits: 1` (the formatter this replaced in
 * the Discover panel) renders 9240 as "9.2K", and a viewer locale renders
 * Persian digits.
 */
describe("formatCount", () => {
  test.each([
    [0, "0"],
    [877, "877"],
    [1_000, "1K"],
    [9_240, "9.24K"],
    [28_300, "28.3K"],
    [166_000, "166K"],
    [999_999, "1M"],
    [1_200_000, "1.2M"],
    [16_400_000, "16.4M"],
  ])("%d reads %s", (count, text) => {
    expect(formatCount(count)).toBe(text)
  })
})
