import { describe, expect, test } from "bun:test"
import type { RequestTrendBucket } from "@/client"
import { dailyBars } from "./trend"

const bucket = (
  start: string,
  end: string,
  kind: string,
  charged: boolean,
  useful: number,
  idle = 0,
  wasted = 0,
): RequestTrendBucket => ({
  start,
  end,
  kind,
  charged,
  useful,
  idle,
  wasted,
  ledgerOnly: 0,
})

const at = (iso: string) => Date.parse(`${iso}Z`)
const none = new Set<never>()

describe("dailyBars", () => {
  const range = { start: at("2026-10-01T00:00"), end: at("2026-10-04T00:00") }
  const buckets = [
    // A daily total, an hourly one and two 5-minute ones, the last cut short.
    bucket("2026-10-01T00:00:00", "2026-10-02T00:00:00", "auto", true, 5, 1),
    bucket(
      "2026-10-02T13:00:00",
      "2026-10-02T14:00:00",
      "probe",
      false,
      2,
      0,
      7,
    ),
    bucket("2026-10-03T23:50:00", "2026-10-03T23:55:00", "auto", true, 1),
    bucket(
      "2026-10-03T23:55:00",
      "2026-10-03T23:57:00",
      "auto",
      false,
      0,
      0,
      4,
    ),
  ]

  test("sums every tier's buckets into its UTC day, Charged apart", () => {
    const { grain, bars } = dailyBars(buckets, range, none, none)
    expect(grain).toBe("day")
    expect(bars.map((b) => [b.x, b.charged, b.uncharged])).toEqual([
      ["2026-10-01", 6, 0],
      ["2026-10-02", 0, 9],
      ["2026-10-03", 1, 4],
    ])
    expect(bars[1].at).toBe(at("2026-10-02T00:00"))
  })

  test("a day before recording draws the ledger's total, whatever outcome is hidden (RQS-16)", () => {
    const ledger = {
      ...bucket("2026-10-01T00:00:00", "2026-10-02T00:00:00", "auto", true, 0),
      ledgerOnly: 12,
    }
    const { bars } = dailyBars([ledger], range, none, new Set(["useful"]))
    expect(bars.map((b) => b.charged)).toEqual([12, 0, 0])
  })

  test("a day with no Requests is still drawn, as nothing", () => {
    const { bars } = dailyBars(buckets.slice(0, 1), range, none, none)
    expect(bars.map((b) => [b.x, b.charged + b.uncharged])).toEqual([
      ["2026-10-01", 6],
      ["2026-10-02", 0],
      ["2026-10-03", 0],
    ])
  })

  test("hidden kinds and outcomes add nothing", () => {
    const { bars } = dailyBars(
      buckets,
      range,
      new Set(["probe"]),
      new Set(["idle"] as const),
    )
    expect(bars.map((b) => b.charged + b.uncharged)).toEqual([5, 0, 5])
  })

  test("an open start begins at the first day with Requests", () => {
    const { bars } = dailyBars(
      buckets,
      { start: 0, end: range.end },
      none,
      none,
    )
    expect(bars[0].x).toBe("2026-10-01")
    expect(bars).toHaveLength(3)
  })

  test("one day is drawn by the hour", () => {
    const day = { start: at("2026-10-03T00:00"), end: at("2026-10-04T00:00") }
    const { grain, bars, dailyOnly } = dailyBars(buckets, day, none, none)
    expect([grain, dailyOnly]).toEqual(["hour", false])
    expect(bars).toHaveLength(24)
    expect(bars[23]).toMatchObject({ x: "23:00", charged: 1, uncharged: 4 })
  })

  test("a day past the hourly totals has only its daily total", () => {
    // Cut mid-day: the server widened the read to the whole day.
    const day = { start: at("2026-10-01T09:30"), end: at("2026-10-01T18:00") }
    const { grain, dailyOnly } = dailyBars(buckets.slice(0, 1), day, none, none)
    expect([grain, dailyOnly]).toEqual(["hour", true])
  })
})
