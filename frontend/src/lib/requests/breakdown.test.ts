import { describe, expect, test } from "bun:test"
import type { ChannelRequestTotals, RequestTotals } from "@/client"
import {
  channelColumns,
  channelRows,
  chargedCounts,
  kindRows,
  listChannels,
  type Outcome,
  rangeText,
  requestsRange,
  statTotals,
} from "./breakdown"

const totals = (
  kind: string,
  useful: number,
  idle: number,
  wasted: number,
  charged = 0,
): RequestTotals => ({
  kind,
  requests: useful + idle + wasted,
  useful,
  idle,
  wasted,
  charged,
  newPosts: 0,
  repeatedPosts: 0,
})
const onChannel = (
  channel: string | null,
  kind: string,
  useful: number,
  idle: number,
  wasted: number,
): ChannelRequestTotals => ({
  ...totals(kind, useful, idle, wasted),
  channel,
})
const none = new Set<never>()
const hide = (...o: Outcome[]) => new Set<Outcome>(o)

describe("the kind table", () => {
  const byKind = [totals("bulk", 10, 0, 0), totals("auto", 30, 50, 20)]

  test("ranks kinds by Requests and gives each its share", () => {
    const { rows, max } = kindRows(byKind, none, none)
    expect(rows.map((r) => [r.kind.label, r.total, r.share])).toEqual([
      ["Auto sync", 100, 100 / 110],
      ["Manual bulk", 10, 10 / 110],
    ])
    expect(max).toBe(100)
  })

  test("a hidden kind keeps its row but leaves every share", () => {
    const { rows, max } = kindRows(byKind, new Set(["auto"]), none)
    expect(rows.map((r) => [r.kind.id, r.hidden, r.share])).toEqual([
      ["auto", true, null],
      ["bulk", false, 1],
    ])
    expect(max).toBe(10)
  })

  test("a hidden outcome leaves the totals, so the rest reads in proportion", () => {
    const { rows } = kindRows(byKind, none, hide("idle"))
    expect(rows.map((r) => [r.kind.id, r.total, r.idle, r.share])).toEqual([
      ["auto", 50, 0, 50 / 60],
      ["bulk", 10, 0, 10 / 60],
    ])
  })

  test("marks the uncharged kinds and names an unknown one by its id", () => {
    const { rows } = kindRows(
      [totals("probe", 1, 0, 0), totals("later", 2, 0, 0)],
      none,
      none,
    )
    expect(rows.map((r) => [r.kind.label, r.kind.charged])).toEqual([
      ["later", true],
      ["Directory probe", false],
    ])
  })
})

describe("the Channel table", () => {
  const byChannel = [
    onChannel("news", "auto", 4, 5, 0),
    onChannel("news", "single", 1, 0, 9),
    onChannel("tech", "auto", 2, 0, 0),
    onChannel(null, "probe", 400, 100, 500),
    onChannel(null, "handle", 3, 0, 0),
  ]

  test("one row per Channel across its kinds, the aggregates as rows of their own", () => {
    const rows = channelRows(byChannel, none, none)
    expect(
      rows.map((r) => [r.label, r.total, r.wasted, r.aggregate, r.mainKind]),
    ).toEqual([
      ["Directory probes", 1000, 500, true, "probe"],
      ["@news", 19, 9, false, "single"],
      ["Handle checks", 3, 0, true, "handle"],
      ["@tech", 2, 0, false, "auto"],
    ])
  })

  test("hidden kinds and outcomes leave the rows, and an emptied row goes", () => {
    const rows = channelRows(byChannel, new Set(["probe"]), hide("useful"))
    expect(rows.map((r) => [r.label, r.total])).toEqual([["@news", 14]])
  })

  test("search matches the name with or without its @", () => {
    const rows = channelRows(byChannel, none, none)
    const names = (q: string) =>
      listChannels(rows, q, "total", "desc").map((r) => r.label)
    expect(names("NEW")).toEqual(["@news"])
    expect(names("@te")).toEqual(["@tech"])
    expect(names("probes")).toEqual(["Directory probes"])
  })

  test("sorts by any column, either way", () => {
    const rows = channelRows(byChannel, none, none)
    const order = (key: Parameters<typeof listChannels>[2], up = false) =>
      listChannels(rows, "", key, up ? "asc" : "desc").map((r) => r.label)
    expect(order("wasteShare")).toEqual([
      "Directory probes",
      "@news",
      "Handle checks",
      "@tech",
    ])
    expect(order("idleShare")[0]).toBe("@news")
    expect(order("channel", true)).toEqual([
      "Directory probes",
      "Handle checks",
      "@news",
      "@tech",
    ])
  })

  test("a hidden outcome takes its columns away", () => {
    expect(channelColumns(none).map((c) => c.label)).toEqual([
      "Requests",
      "Idle",
      "Wasted",
      "Idle %",
      "Wasted %",
    ])
    expect(channelColumns(hide("wasted")).map((c) => c.label)).toEqual([
      "Requests",
      "Idle",
      "Idle %",
    ])
  })
})

describe("the totals", () => {
  const byKind = [totals("auto", 6, 3, 1, 10), totals("probe", 0, 4, 6)]

  test("All, Charged and Uncharged count every Request", () => {
    expect(chargedCounts(byKind)).toEqual({
      all: 20,
      charged: 10,
      uncharged: 10,
    })
  })

  test("the stat strip adds up every kind", () => {
    expect(statTotals(byKind)).toEqual({
      total: 20,
      useful: 6,
      idle: 7,
      wasted: 7,
    })
  })
})

describe("the range", () => {
  const at = Date.parse("2026-10-23T12:34:56.789Z")

  test("a live range resolves against now, cut to the minute", () => {
    const range = requestsRange(
      { mode: "live", start: -60 * 60_000, end: 0 },
      at,
    )
    expect(range).toEqual({
      start: Date.parse("2026-10-23T11:34:00Z"),
      end: Date.parse("2026-10-23T12:34:00Z"),
    })
  })

  test("an open end reads as everything kept, up to now", () => {
    expect(requestsRange({ mode: "fixed" }, at)).toEqual({
      start: 0,
      end: Date.parse("2026-10-23T12:34:00Z"),
    })
  })

  test("whole days read as days, a cut range to the minute, all in UTC", () => {
    const day = (d: string) => Date.parse(`${d}T00:00:00Z`)
    expect(rangeText(day("2026-10-01"), day("2026-10-02"))).toBe(
      "on 2026-10-01",
    )
    expect(rangeText(day("2026-10-01"), day("2026-10-08"))).toBe(
      "from 2026-10-01 to 2026-10-07",
    )
    expect(
      rangeText(Date.parse("2026-10-01T06:30:00Z"), day("2026-10-02")),
    ).toBe("from 2026-10-01 06:30 to 2026-10-02 00:00")
    expect(rangeText(0, day("2026-10-02"))).toBe("until 2026-10-02 00:00")
  })
})
