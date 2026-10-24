import { describe, expect, test } from "bun:test"
import type { RequestTrendBucket } from "@/client"
import type { Outcome } from "./breakdown"
import {
  bandLabels,
  fromPlotly,
  grainOf,
  legendClick,
  legendDoubleClick,
  rebucket,
  type Split,
  scaleOf,
  shadeOf,
  storedBuckets,
  tierBands,
  toPlotly,
  trendChart,
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

test("grainOf names what a bucket adds up", () => {
  expect(
    [5, 15, 30, 60, 120, 720, 1440].map((m) => grainOf(m * 60_000)),
  ).toEqual([
    "5-minute total, from each Request",
    "15-minute total",
    "30-minute total",
    "hourly total",
    "2-hour total",
    "12-hour total",
    "daily total",
  ])
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

describe("scaleOf", () => {
  test("a burst over 1.5 times the 99th percentile caps the scale at 1.15 times it", () => {
    // 101 buckets: the 99th percentile is the hundredth, 10; the burst is 100.
    const view = [...Array.from({ length: 100 }, () => 10), 100]
    expect(scaleOf(view)).toEqual({ cap: 11.5, range: [0, 11.5] })
  })

  test("without a burst the tallest sets the scale, with a little room", () => {
    // The 99th percentile of three is the second, 10; 15 is just 1.5 times it.
    expect(scaleOf([15, 10, 2])).toEqual({ cap: null, range: [0, 15.75] })
    expect(scaleOf([16, 10, 2]).cap).toBeCloseTo(11.5)
  })

  test("an empty or idle view stays flat", () => {
    expect(scaleOf([])).toEqual({ cap: null, range: [0, 1] })
    expect(scaleOf([0, 0, 0])).toEqual({ cap: null, range: [0, 1] })
  })
})

describe("trendChart", () => {
  const none = new Set<never>()
  const view: [number, number] = [
    at("2026-10-20T09:00"),
    at("2026-10-20T11:00"),
  ]
  // Two 5-minute buckets: auto 3 Useful, 1 Idle and probes 2 Useful; then auto 6 Wasted.
  const { size, points } = rebucket(
    storedBuckets([
      bucket("2026-10-20T10:00:00", "2026-10-20T10:05:00", "auto", 3, 1),
      bucket("2026-10-20T10:00:00", "2026-10-20T10:05:00", "probe", 2),
      bucket("2026-10-20T10:05:00", "2026-10-20T10:10:00", "auto", 0, 0, 6),
    ]),
    ...view,
  )
  const chart = (
    kind: Split,
    outcome: Split,
    hiddenKinds: ReadonlySet<string> = none,
    hiddenOutcomes: ReadonlySet<Outcome> = none,
  ) =>
    trendChart(
      points,
      size,
      view,
      { kind, outcome },
      hiddenKinds,
      hiddenOutcomes,
    )
  const names = (c: ReturnType<typeof chart>) =>
    c.rows.map((r) => [r.name, r.series.map((s) => s.name)])

  test("merged, it is one row of one series, in Requests per hour", () => {
    const c = chart("off", "off")
    expect(c.legend).toBeNull()
    expect(names(c)).toEqual([["All Requests", ["All Requests"]]])
    expect(c.rows[0].series[0].y).toEqual([72, 72, 0])
  })

  test("stacked, a row splits its area by each kind and outcome with Requests", () => {
    const c = chart("stacked", "stacked")
    expect(c.legend).toBe("kind")
    expect(c.rows).toHaveLength(1)
    expect(c.rows[0].series.map((s) => [s.part, s.name, s.group, s.y])).toEqual(
      [
        [{ kind: "auto", outcome: "useful" }, "Auto sync", "auto", [36, 0, 0]],
        [{ kind: "auto", outcome: "idle" }, "Auto sync", "auto", [12, 0, 0]],
        [{ kind: "auto", outcome: "wasted" }, "Auto sync", "auto", [0, 72, 0]],
        [
          { kind: "probe", outcome: "useful" },
          "Directory probe",
          "probe",
          [24, 0, 0],
        ],
      ],
    )
    // Outcomes alone stacked: the legend lists them.
    const outcomes = chart("off", "stacked")
    expect(outcomes.legend).toBe("outcome")
    expect(names(outcomes)).toEqual([
      ["All Requests", ["Useful", "Idle", "Wasted"]],
    ])
    expect(outcomes.rows[0].series.map((s) => s.y)).toEqual([
      [60, 0, 0],
      [12, 0, 0],
      [0, 72, 0],
    ])
  })

  test("separate, a row per value; both separate, a row per kind and outcome", () => {
    expect(names(chart("separate", "stacked"))).toEqual([
      ["Auto sync", ["Useful", "Idle", "Wasted"]],
      ["Directory probe", ["Useful"]],
    ])
    expect(chart("stacked", "separate").legend).toBe("kind")
    expect(names(chart("off", "separate"))).toEqual([
      ["Useful", ["Useful"]],
      ["Idle", ["Idle"]],
      ["Wasted", ["Wasted"]],
    ])
    const both = chart("separate", "separate")
    expect(both.legend).toBeNull()
    expect(both.rows.map((r) => r.name)).toEqual([
      "Auto sync · Useful",
      "Auto sync · Idle",
      "Auto sync · Wasted",
      "Directory probe · Useful",
    ])
  })

  test("a hidden value stays in the legend, greyed and empty, and leaves the rest", () => {
    const probes = new Set(["probe"])
    const listed = chart("stacked", "off", probes)
    expect(listed.rows[0].series.map((s) => [s.name, s.off, s.y])).toEqual([
      ["Auto sync", false, [48, 72, 0]],
      ["Directory probe", true, [0, 0, 0]],
    ])
    expect(names(chart("separate", "stacked", probes))).toEqual([
      ["Auto sync", ["Useful", "Idle", "Wasted"]],
    ])
    expect(
      names(chart("stacked", "stacked", none, new Set(["idle"] as const))),
    ).toEqual([["All Requests", ["Auto sync", "Auto sync", "Directory probe"]]])
    expect(chart("stacked", "stacked").kinds).toEqual(["auto", "probe"])
  })

  test("each row's scale comes from the buckets in view, a burst capped with notches", () => {
    // Two hours of 5-minute auto buckets of 1, one of 50 at 10:00, probes once.
    const fives = Array.from({ length: 24 }, (_, i) => {
      const t = new Date(at("2026-10-20T09:00") + i * 300_000)
      const start = t.toISOString().slice(0, 19)
      const end = new Date(t.getTime() + 300_000).toISOString().slice(0, 19)
      return bucket(start, end, "auto", i === 12 ? 50 : 1)
    })
    const stored = storedBuckets([
      ...fives,
      bucket("2026-10-20T09:30:00", "2026-10-20T09:35:00", "probe", 2),
    ])
    const split = (from: string, to: string) => {
      const v: [number, number] = [at(from), at(to)]
      const r = rebucket(stored, ...v)
      return trendChart(
        r.points,
        r.size,
        v,
        { kind: "separate", outcome: "stacked" },
        none,
        none,
      ).rows
    }
    const [auto, probe] = split("2026-10-20T09:00", "2026-10-20T11:00")
    // Each bucket of 1 is 12 an hour; the burst is 600.
    expect(auto.cap).toBeCloseTo(13.8)
    expect(auto.range[1]).toBeCloseTo(13.8)
    expect(auto.notches).toEqual([{ x: "2026-10-20T10:00:00.000", total: 600 }])
    // The probes' row keeps its own scale.
    expect(probe.cap).toBeNull()
    expect(probe.range[1]).toBeCloseTo(25.2)
    expect(probe.notches).toEqual([])
    // With the burst out of view, nothing is capped.
    const [early] = split("2026-10-20T09:00", "2026-10-20T09:55")
    expect(early.cap).toBeNull()
    expect(early.range[1]).toBeCloseTo(12.6)
  })
})

describe("the legend", () => {
  const shown = {
    hiddenKinds: new Set<string>(),
    hiddenOutcomes: new Set<Outcome>(),
  }
  const kinds = ["auto", "bulk", "probe"]

  test("a click is the kind's Show box, or the outcome's chip", () => {
    expect(legendClick("kind", "probe")(shown)).toEqual({
      hiddenKinds: new Set(["probe"]),
    })
    expect(
      legendClick(
        "kind",
        "probe",
      )({ ...shown, hiddenKinds: new Set(["probe"]) }),
    ).toEqual({ hiddenKinds: new Set() })
    expect(legendClick("outcome", "idle")(shown)).toEqual({
      hiddenOutcomes: new Set(["idle"]),
    })
    // The last outcome shown stays shown.
    const lastShown = {
      ...shown,
      hiddenOutcomes: new Set<Outcome>(["idle", "wasted"]),
    }
    expect(legendClick("outcome", "useful")(lastShown)).toEqual({
      hiddenOutcomes: new Set(["idle", "wasted"]),
    })
  })

  test("a double click shows that one alone, or everything again", () => {
    const alone = legendDoubleClick("kind", "bulk", kinds)(shown)
    expect(alone).toEqual({ hiddenKinds: new Set(["auto", "probe"]) })
    expect(
      legendDoubleClick("kind", "bulk", kinds)({ ...shown, ...alone }),
    ).toEqual({ hiddenKinds: new Set() })
    // Another, while one is alone, is alone instead.
    expect(
      legendDoubleClick("kind", "auto", kinds)({ ...shown, ...alone }),
    ).toEqual({ hiddenKinds: new Set(["bulk", "probe"]) })
    expect(legendDoubleClick("outcome", "wasted", kinds)(shown)).toEqual({
      hiddenOutcomes: new Set(["useful", "idle"]),
    })
  })
})

test("shadeOf steps a kind's colour toward the surface by outcome, opaque", () => {
  // Auto sync's blue on white: all of it, 55% of it, 30% of it.
  expect(shadeOf("#2a78d6", "#ffffff", "useful")).toBe("rgb(42,120,214)")
  expect(shadeOf("#2a78d6", "#ffffff", "idle")).toBe("rgb(138,181,232)")
  expect(shadeOf("#2a78d6", "#ffffff", "wasted")).toBe("rgb(191,215,243)")
  // Toward a dark surface it darkens; a short hex reads as its long form.
  expect(shadeOf("#fff", "#000", "idle")).toBe("rgb(140,140,140)")
})

describe("days before recording (RQS-16)", () => {
  const none = new Set<never>()
  const view: [number, number] = [
    at("2026-10-19T00:00"),
    at("2026-10-21T00:00"),
  ]
  // The ledger's day: 48 auto sync Requests, no outcome. Then 24 recorded Useful.
  const { size, points } = rebucket(
    storedBuckets([
      {
        ...bucket("2026-10-19T00:00:00", "2026-10-20T00:00:00", "auto", 0),
        ledgerOnly: 48,
      },
      bucket("2026-10-20T00:00:00", "2026-10-21T00:00:00", "auto", 24),
    ]),
    ...view,
  )
  const chart = (
    kind: Split,
    outcome: Split,
    hiddenOutcomes: ReadonlySet<Outcome> = none,
  ) => trendChart(points, size, view, { kind, outcome }, none, hiddenOutcomes)
  const series = (c: ReturnType<typeof chart>) =>
    c.rows.map((r) => [r.name, r.series.map((s) => [s.name, s.y])])

  test("merged, the ledger's day draws whatever outcome is hidden", () => {
    expect(series(chart("off", "off", new Set(["useful"])))).toEqual([
      ["All Requests", [["All Requests", [2, 0, 0]]]],
    ])
  })

  test("told apart by outcome, it is a series of its own, before recording", () => {
    expect(series(chart("off", "stacked"))).toEqual([
      [
        "All Requests",
        [
          ["Useful", [0, 1, 0]],
          ["Before recording", [2, 0, 0]],
        ],
      ],
    ])
    expect(series(chart("separate", "separate")).map(([name]) => name)).toEqual(
      ["Auto sync · Useful", "Auto sync · Before recording"],
    )
  })

  test("the legend cannot hide it: there is no outcome to hide", () => {
    const shown = { hiddenKinds: none, hiddenOutcomes: none }
    expect(legendClick("outcome", "ledger")(shown)).toEqual({})
    expect(legendDoubleClick("outcome", "ledger", ["auto"])(shown)).toEqual({})
  })
})
