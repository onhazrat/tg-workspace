/**
 * The one Time bound text form (TB-01): Live ends as signed offsets with
 * `now`, Fixed ends as UTC instants, `..` between, either end open. The
 * Directory filter reads and prints it today, the Channel filter next.
 */
import { describe, expect, test } from "bun:test"
import { ParseError } from "@/lib/filter-text"
import {
  parseTimeBound,
  TIME_BOUND,
  timeBoundText,
  timeBoundWords,
} from "./text"

const DAY = 86_400_000
const HOUR = 3_600_000

describe("the text form", () => {
  test.each([
    ["-3d..", { mode: "live", start: -3 * DAY }],
    ["..-50d", { mode: "live", end: -50 * DAY }],
    ["now..+2d", { mode: "live", start: 0, end: 2 * DAY }],
    ["-90m..-1h", { mode: "live", start: -90 * 60_000, end: -HOUR }],
    ["-1w..", { mode: "live", start: -7 * DAY }],
    ["2026-10-01T00:00Z..", { mode: "fixed", start: Date.UTC(2026, 9, 1) }],
    [
      "2026-10-01T00:00Z..2026-10-15T12:30Z",
      {
        mode: "fixed",
        start: Date.UTC(2026, 9, 1),
        end: Date.UTC(2026, 9, 15, 12, 30),
      },
    ],
    [
      "2026-10-01T20:30:15Z..",
      { mode: "fixed", start: Date.UTC(2026, 9, 1, 20, 30, 15) },
    ],
  ] as const)("%s parses and prints back unchanged", (text, bound) => {
    const m = new RegExp(`^${TIME_BOUND}$`, "iu").exec(text)
    expect(m).not.toBeNull()
    const parsed = parseTimeBound(m?.[1], m?.[2])
    expect(parsed).toEqual(bound)
    expect(timeBoundText(parsed)).toBe(text)
  })

  test.each([
    ["no end at all", undefined, undefined],
    ["a Live and a Fixed end", "now", "2026-10-01T00:00Z"],
    ["an end before the start", "-1d", "-2d"],
    ["an end at the start", "-1d", "-1d"],
  ])("%s is refused", (_, start, end) => {
    expect(() => parseTimeBound(start, end)).toThrow(ParseError)
  })
})

describe("the chip words", () => {
  test.each([
    [{ mode: "live", start: -3 * DAY }, "Last post from 3 days ago"],
    [{ mode: "live", end: -50 * DAY }, "Last post before 50 days ago"],
    [
      { mode: "live", start: 0, end: 2 * DAY },
      "Last post from now to in 2 days",
    ],
    [{ mode: "live", start: -HOUR }, "Last post from 1 hour ago"],
    [{ mode: "fixed", none: true }, "Last post: no value"],
  ] as const)("%j", (cond, words) => {
    expect(timeBoundWords("Last post", cond, "en", "UTC")).toBe(words)
  })
})
