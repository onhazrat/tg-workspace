/**
 * The one binning rule every Spread built in the browser uses (ADR-037), and
 * how a pick becomes a Number bound.
 */
import { describe, expect, test } from "bun:test"
import { MINUTE_MS } from "@/lib/analysis-window"
import { binSpread, median, nice, pickBound } from "./spread"

const filled = (bins: { count: number }[]) =>
  bins.flatMap((b, i) => (b.count > 0 ? [i] : []))

/**
 * The server's twin is `value_histogram` (PTI-01), which bins the Posts
 * editors' bars. `test_post_value_histogram.py` pins these three cases, its
 * `vh_lin`, `vh_log` and `vh_zero`, to the same bars, edges and median:
 * change the rule here and that copy is what disagrees.
 */
describe("the binning rule the server shares", () => {
  test.each([
    {
      name: "linear",
      values: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
      log: false,
      bars: [0, 3, 7, 10, 14, 17, 21, 24, 28, 31],
      mid: 550,
      median: 600,
    },
    {
      name: "logarithmic",
      values: [1, 5, 50, 500, 5000],
      log: true,
      bars: [0, 6, 14, 23, 31],
      mid: 5000 ** 0.5,
      median: 50,
    },
    {
      name: "logarithmic on one plus the value from zero",
      values: [0, 9, 99, 999],
      log: true,
      bars: [0, 10, 21, 31],
      mid: 1000 ** 0.5 - 1,
      median: 99,
    },
  ])("$name", ({ values, log, bars, mid, median }) => {
    const got = binSpread([...values], null)
    expect(got.log).toBe(log)
    expect(got.bars.length).toBe(32)
    expect(filled(got.bars)).toEqual([...bars])
    expect(got.bars[0].lo).toBe(values[0])
    expect(got.bars[16].lo).toBeCloseTo(mid, 6)
    expect(got.bars[31].hi).toBeCloseTo(values[values.length - 1], 6)
    expect(got.median).toBe(median)
  })
})

describe("binSpread", () => {
  test("a fractional range spanning a hundredfold goes logarithmic", () => {
    const got = binSpread([0.01, 0.05, 0.2, 1, 5], null)
    expect(got.log).toBe(true)
    expect(filled(got.bars)).toHaveLength(5)
  })

  test("a zoom bins only its range, on the whole spread's scale", () => {
    const values = Array.from({ length: 91 }, (_, i) => 100 + i * 10)
    const got = binSpread(values, [400, 700])
    expect([got.lo, got.hi]).toEqual([100, 1000])
    expect(got.bars[0]).toMatchObject({ lo: 400, count: 1 })
    expect(got.bars[31]).toMatchObject({ hi: 700, count: 1 })
    expect(got.bars.reduce((n, b) => n + b.count, 0)).toBe(31)
  })

  test("moments are linear and binned by their minute", () => {
    const t = Date.UTC(2026, 0, 1)
    // A thousandfold would be logarithmic for a number.
    const values = [t + 5_000, t + 50_000, t + 32 * MINUTE_MS - 1]
    const got = binSpread(values, null, { moments: true })
    expect(got.log).toBe(false)
    // From the first minute to one past the last: a minute a bar.
    expect(got.bars[0].lo).toBe(t)
    expect(got.bars[31].hi).toBe(t + 32 * MINUTE_MS)
    expect(filled(got.bars)).toEqual([0, 31])
    expect(got.bars[0].count).toBe(2)
    expect(got.barOf(t + 59_999)).toBe(0)
    expect(got.barOf(t + 31 * MINUTE_MS)).toBe(31)
    expect(got.barOf(t + 40 * MINUTE_MS)).toBeNull()
  })

  test("values sharing a minute share a bar, whatever the bars' width", () => {
    const t = Date.UTC(2026, 0, 1)
    // 33 minutes over 32 bars: a bar is a little over a minute wide, so the
    // end of a minute would land in the next bar if it were not floored.
    const got = binSpread([t, t + MINUTE_MS, t + 32 * MINUTE_MS], null, {
      moments: true,
    })
    expect(got.barOf(t + MINUTE_MS + 59_000)).toBe(got.barOf(t + MINUTE_MS))
  })
})

describe("median and nice", () => {
  test("the median is the upper middle value", () => {
    expect(median([1, 2, 3, 4])).toBe(3)
    expect(median([5])).toBe(5)
  })

  test("nice keeps two significant figures", () => {
    expect(nice(1187.43)).toBe(1200)
    expect(nice(0.01234)).toBe(0.012)
  })
})

describe("pickBound", () => {
  const run = { from: 0, to: 0 }
  test("rounds each set end to two figures and keeps an open one open", () => {
    expect(
      pickBound({ min: 184.375, max: 240.625, all: false, run }, 100),
    ).toEqual({ min: 180, max: 240 })
    expect(pickBound({ max: 212.5, all: false, run }, 100)).toEqual({
      max: 210,
    })
  })

  test("everything with a value keeps the whole spread's low end exactly", () => {
    expect(pickBound({ all: true, run }, 123.456)).toEqual({ min: 123.456 })
  })
})
