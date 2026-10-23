import { describe, expect, test } from "bun:test"
import { panned, requestedSpread, tierEdges } from "./spread"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (iso: string) => Date.parse(`${iso}Z`)

/** A day kept only as its daily total, then two hours of the next day. */
const BUCKETS = [
  { start: "2026-10-01T00:00:00", end: "2026-10-02T00:00:00", requests: 40 },
  { start: "2026-10-02T06:00:00", end: "2026-10-02T07:00:00", requests: 7 },
  { start: "2026-10-03T09:00:00", end: "2026-10-03T10:00:00", requests: 3 },
]

describe("requestedSpread", () => {
  test("nothing kept is nothing to spread", () => {
    expect(requestedSpread([], null)).toBeNull()
  })

  test("the whole spread is one bar per UTC day", () => {
    const spread = requestedSpread(BUCKETS, null)
    expect(spread?.min).toBe(at("2026-10-01T00:00:00"))
    expect(spread?.max).toBe(at("2026-10-03T10:00:00"))
    expect(spread?.total).toBe(50)
    expect(spread?.bins).toEqual([
      {
        lo: at("2026-10-01T00:00:00"),
        hi: at("2026-10-02T00:00:00"),
        count: 40,
      },
      {
        lo: at("2026-10-02T00:00:00"),
        hi: at("2026-10-03T00:00:00"),
        count: 7,
      },
      {
        lo: at("2026-10-03T00:00:00"),
        hi: at("2026-10-04T00:00:00"),
        count: 3,
      },
    ])
  })

  test("the median is the instant half the Requests were made before", () => {
    // 40 of 50 at the first midnight: half are made by then.
    expect(requestedSpread(BUCKETS, null)?.median).toBe(
      at("2026-10-01T00:00:00"),
    )
  })

  test("zoomed under two days, a bar per hour, a day's total at its midnight", () => {
    const zoom: [number, number] = [
      at("2026-10-01T22:30:00"),
      at("2026-10-02T07:00:00"),
    ]
    const bins = requestedSpread(BUCKETS, zoom)?.bins ?? []
    expect(bins).toHaveLength(9)
    expect(bins[0].lo).toBe(at("2026-10-01T22:00:00"))
    expect(bins.at(-1)?.hi).toBe(at("2026-10-02T07:00:00"))
    expect(bins.map((b) => b.count)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 7])
    // The whole spread's ends stay, zoomed or not.
    expect(requestedSpread(BUCKETS, zoom)?.min).toBe(at("2026-10-01T00:00:00"))
  })
})

describe("tierEdges", () => {
  const now = at("2026-10-31T12:00:00")

  test("marks where each Request and each hour stop being kept", () => {
    expect(tierEdges(now, 7, 30, now - 40 * DAY, now)).toEqual([
      { at: now - 7 * DAY, label: "7d · each Request" },
      { at: now - 30 * DAY, label: "30d · hourly" },
    ])
  })

  test("an edge outside the bars is not drawn", () => {
    expect(tierEdges(now, 7, 30, now - 10 * DAY, now)).toEqual([
      { at: now - 7 * DAY, label: "7d · each Request" },
    ])
  })
})

describe("panned", () => {
  test("moves the zoom along, its span kept", () => {
    expect(panned([10, 20], 5, 0, 100)).toEqual([15, 25])
  })

  test("stops at either end of the whole spread", () => {
    expect(panned([10, 20], -50, 0, 100)).toEqual([0, 10])
    expect(panned([10, 20], 500, 0, 100)).toEqual([90, 100])
  })
})
