import { describe, expect, test } from "bun:test"
import type { RequestTrendBucket } from "@/client"
import {
  bandLabels,
  fromPlotly,
  rebucket,
  storedBuckets,
  tierBands,
  toPlotly,
  trendLine,
} from "./zoom"

const bucket = (
  start: string,
  end: string,
  kind: string,
  useful: number,
  idle = 0,
  wasted = 0,
  charged = true,
): RequestTrendBucket => ({ start, end, kind, charged, useful, idle, wasted })

const at = (iso: string) => Date.parse(`${iso}Z`)

describe("rebucket", () => {
  test("re-sums to the finest size keeping about 220 buckets in view", () => {
    const stored = storedBuckets([
      bucket("2026-10-20T10:00:00", "2026-10-20T10:05:00", "auto", 3),
      bucket("2026-10-20T10:05:00", "2026-10-20T10:10:00", "auto", 4, 1),
      bucket("2026-10-20T10:10:00", "2026-10-20T10:15:00", "bulk", 0, 0, 2),
      bucket("2026-10-20T10:15:00", "2026-10-20T10:20:00", "auto", 7),
    ])
    // Six hours is 72 five-minute buckets: none re-summed.
    const six = rebucket(stored, at("2026-10-20T06:00"), at("2026-10-20T12:00"))
    expect(six.size).toBe(5 * 60_000)
    expect(six.points).toHaveLength(4)
    // A day is 288 of them, too many; 96 of 15 minutes fit. Sums, not means.
    const day = rebucket(stored, at("2026-10-20T00:00"), at("2026-10-21T00:00"))
    expect(day.size).toBe(15 * 60_000)
    expect(day.points.map((p) => [p.t, p.span])).toEqual([
      [at("2026-10-20T10:00"), 15 * 60_000],
      [at("2026-10-20T10:15"), 15 * 60_000],
    ])
    expect(day.points[0].counts).toEqual({
      "auto:useful": 7,
      "auto:idle": 1,
      "auto:wasted": 0,
      "bulk:useful": 0,
      "bulk:idle": 0,
      "bulk:wasted": 2,
    })
  })

  test("steps through the sizes up to a day as the view widens", () => {
    const sizeFor = (days: number) =>
      rebucket([], 0, days * 86_400_000).size / 60_000
    expect(sizeFor(7)).toBe(60)
    expect(sizeFor(14)).toBe(120)
    expect(sizeFor(30)).toBe(240)
    expect(sizeFor(50)).toBe(360)
    expect(sizeFor(100)).toBe(720)
    expect(sizeFor(400)).toBe(1440)
  })

  test("never goes finer than the tier a bucket was kept at", () => {
    const stored = storedBuckets([
      bucket("2026-09-01T00:00:00", "2026-09-02T00:00:00", "auto", 48),
      bucket("2026-10-01T13:00:00", "2026-10-01T14:00:00", "auto", 6),
      // A 5-minute bucket the range's end cut to two minutes.
      bucket("2026-10-20T10:00:00", "2026-10-20T10:02:00", "auto", 1),
    ])
    const { size, points } = rebucket(
      stored,
      at("2026-09-01T00:00"),
      at("2026-09-02T00:00"),
    )
    expect(size).toBe(15 * 60_000)
    expect(points.map((p) => p.span / 60_000)).toEqual([1440, 60, 15])
    expect(points[2].t).toBe(at("2026-10-20T10:00"))
  })
})

describe("trendLine", () => {
  const none = new Set<never>()
  const stored = storedBuckets([
    bucket("2026-10-20T10:00:00", "2026-10-20T10:05:00", "auto", 3, 1),
    bucket(
      "2026-10-20T10:00:00",
      "2026-10-20T10:05:00",
      "probe",
      2,
      0,
      0,
      false,
    ),
    bucket("2026-10-20T10:05:00", "2026-10-20T10:10:00", "auto", 0, 0, 6),
  ])
  const twoHours = rebucket(
    stored,
    at("2026-10-20T09:00"),
    at("2026-10-20T11:00"),
  )

  test("fine buckets are steps, each held to its end, in Requests per hour", () => {
    const line = trendLine(twoHours.points, twoHours.size, none, none)
    expect(line.shape).toBe("hv")
    // The last step closes at its bucket's end.
    expect(line.x).toEqual([
      "2026-10-20T10:00:00.000",
      "2026-10-20T10:05:00.000",
      "2026-10-20T10:10:00.000",
    ])
    expect(line.y).toEqual([72, 72, 0])
  })

  test("hover gives each bucket's UTC span, grain and exact count", () => {
    expect(trendLine(twoHours.points, twoHours.size, none, none).hover[0]).toBe(
      "from 2026-10-20 10:00 to 2026-10-20 10:05 UTC<br>5-minute total, from each Request · 6 Requests",
    )
    const month = rebucket(
      stored,
      at("2026-10-01T00:00"),
      at("2026-10-31T00:00"),
    )
    expect(trendLine(month.points, month.size, none, none).hover[0]).toBe(
      "from 2026-10-20 08:00 to 2026-10-20 12:00 UTC<br>4-hour total · 12 Requests",
    )
  })

  test("buckets of 30 minutes or more are a spline through their middles", () => {
    const { size, points } = rebucket(
      stored,
      at("2026-10-20T00:00"),
      at("2026-10-23T00:00"),
    )
    const line = trendLine(points, size, none, none)
    expect(line.shape).toBe("spline")
    expect(line.x).toEqual(["2026-10-20T10:15:00.000"])
    expect(line.y).toEqual([24])
  })

  test("hidden kinds and outcomes add nothing", () => {
    const line = trendLine(
      twoHours.points,
      twoHours.size,
      new Set(["probe"]),
      new Set(["idle"] as const),
    )
    expect(line.y.slice(0, 2)).toEqual([36, 72])
    expect(line.hover[0]).toEndWith(" · 3 Requests")
  })
})

describe("tierBands", () => {
  const lo = at("2026-09-01T00:00")
  const hi = at("2026-10-20T12:00")

  test("each tier kept is a band, from the one before it to the next", () => {
    const stored = storedBuckets([
      bucket("2026-09-02T00:00:00", "2026-09-03T00:00:00", "auto", 1),
      bucket("2026-09-30T05:00:00", "2026-09-30T06:00:00", "auto", 1),
      bucket("2026-10-13T11:05:00", "2026-10-13T11:10:00", "auto", 1),
    ])
    expect(tierBands(stored, lo, hi)).toEqual([
      { x0: lo, x1: at("2026-09-30T05:00"), label: "daily totals" },
      {
        x0: at("2026-09-30T05:00"),
        x1: at("2026-10-13T11:05"),
        label: "hourly totals",
      },
      { x0: at("2026-10-13T11:05"), x1: hi, label: "each Request" },
    ])
  })

  test("a range inside one tier is one band", () => {
    const stored = storedBuckets([
      bucket("2026-10-20T10:00:00", "2026-10-20T10:02:00", "auto", 1),
    ])
    expect(tierBands(stored, lo, hi)).toEqual([
      { x0: lo, x1: hi, label: "each Request" },
    ])
    expect(tierBands([], lo, hi)).toEqual([])
  })
})

describe("bandLabels", () => {
  const bands = [
    {
      x0: at("2026-09-01T00:00"),
      x1: at("2026-10-01T00:00"),
      label: "daily totals",
    },
    {
      x0: at("2026-10-01T00:00"),
      x1: at("2026-10-13T00:00"),
      label: "hourly totals",
    },
    {
      x0: at("2026-10-13T00:00"),
      x1: at("2026-10-20T00:00"),
      label: "each Request",
    },
  ]

  test("names each band wide in the view, where the view first shows it", () => {
    expect(
      bandLabels(bands, at("2026-09-01T00:00"), at("2026-10-20T00:00")),
    ).toEqual([
      { x: at("2026-09-01T00:00"), text: "daily totals" },
      { x: at("2026-10-01T00:00"), text: "hourly totals" },
      { x: at("2026-10-13T00:00"), text: "each Request" },
    ])
    // A week from Oct 12: the daily band is out of view, the hourly one a seventh.
    expect(
      bandLabels(bands, at("2026-10-12T12:00"), at("2026-10-19T12:00")),
    ).toEqual([{ x: at("2026-10-13T00:00"), text: "each Request" }])
    expect(
      bandLabels(bands, at("2026-10-12T00:00"), at("2026-10-14T00:00")),
    ).toEqual([
      { x: at("2026-10-12T00:00"), text: "hourly totals" },
      { x: at("2026-10-13T00:00"), text: "each Request" },
    ])
  })
})

describe("Plotly's times", () => {
  test("go over as zoneless UTC strings and come back from either form", () => {
    expect(toPlotly(at("2026-10-20T10:05"))).toBe("2026-10-20T10:05:00.000")
    expect(fromPlotly("2026-10-20 10:05:30.5")).toBe(
      at("2026-10-20T10:05:30.5"),
    )
    expect(fromPlotly("2026-10-20T10:05")).toBe(at("2026-10-20T10:05"))
    expect(fromPlotly(at("2026-10-20T10:05"))).toBe(at("2026-10-20T10:05"))
  })
})
