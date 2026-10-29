import { describe, expect, test } from "bun:test"
import type {
  AccountRequestTotals,
  ChannelRequestTotals,
  RequestTotals,
} from "@/client"
import {
  accountColor,
  accountRows,
  COMPARE_KINDS,
  channelColumns,
  channelRows,
  chargedCounts,
  kindRows,
  leftOutQuery,
  listChannels,
  measureOf,
  type Outcome,
  rangeText,
  requestsRange,
  sinceLabel,
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
  syncs: 0,
  failedSyncs: 0,
  ledgerOnly: 0,
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
      "New Posts / Req",
    ])
    expect(channelColumns(hide("wasted")).map((c) => c.label)).toEqual([
      "Requests",
      "Idle",
      "Idle %",
      "New Posts / Req",
    ])
  })
})

describe("the Channel table's measures (RQS-04)", () => {
  const synced = (
    channel: string | null,
    kind: string,
    requests: [number, number, number],
    syncs: number,
    failedSyncs: number,
    newPosts: number,
  ): ChannelRequestTotals => ({
    ...onChannel(channel, kind, ...requests),
    syncs,
    failedSyncs,
    ledgerOnly: 0,
    newPosts,
  })
  const byChannel = [
    synced("news", "auto", [8, 2, 0], 5, 1, 40),
    synced("news", "single", [1, 0, 1], 1, 0, 3),
    synced("tech", "auto", [2, 2, 0], 2, 2, 0),
    synced(null, "probe", [400, 100, 500], 0, 0, 0),
  ]
  const rows = channelRows(byChannel, none, none)
  const news = rows.find((r) => r.key === "news")
  const probes = rows.find((r) => r.aggregate)

  test("each row adds up its syncs, failed syncs and new Posts, whole and per kind", () => {
    expect(news && [news.syncs, news.failed, news.posts]).toEqual([6, 1, 43])
    expect(news && [...news.kinds].sort()).toEqual(["auto", "single"])
    const auto = news?.perKind.get("auto")
    expect(auto && [auto.total, auto.syncs, auto.failed, auto.posts]).toEqual([
      10, 5, 1, 40,
    ])
  })

  test("a hidden outcome leaves the Requests but every sync still counts", () => {
    const [shown] = channelRows(byChannel, new Set(["probe"]), hide("useful"))
    expect([shown.key, shown.total, shown.syncs, shown.posts]).toEqual([
      "news",
      3,
      6,
      43,
    ])
  })

  test("measures read the whole row or one kind of its work", () => {
    if (!news || !probes) throw new Error("rows missing")
    expect(measureOf(news, "total")).toBe(12)
    expect(measureOf(news, "wasteShare")).toBeCloseTo(100 / 12)
    expect(measureOf(news, "perSync")).toBe(2)
    expect(measureOf(news, "postsPerReq")).toBeCloseTo(43 / 12)
    expect(measureOf(news, "perSync", "auto")).toBe(2)
    expect(measureOf(news, "failed", "single")).toBe(0)
    // No such work on the row, no number: a bound never matches it.
    expect(measureOf(news, "total", "probe")).toBeNull()
    // The aggregate rows fetch no Posts at all.
    expect(measureOf(probes, "postsPerReq")).toBeNull()
    expect(measureOf(probes, "perSync")).toBeNull()
  })

  test("by New Posts per Request, the aggregate rows sort last either way", () => {
    const order = (direction: "asc" | "desc") =>
      listChannels(rows, "", "postsPerReq", direction).map((r) => r.key)
    expect(order("desc")).toEqual(["news", "tech", "probe"])
    expect(order("asc")).toEqual(["tech", "news", "probe"])
  })

  test("a predicate narrows the rows the search keeps", () => {
    const kept = listChannels(rows, "", "total", "desc", (r) => !r.aggregate)
    expect(kept.map((r) => r.key)).toEqual(["news", "tech"])
  })

  test("the rows left out go to the API as handles and as kinds", () => {
    expect(leftOutQuery(new Set([news?.id ?? "", probes?.id ?? ""]))).toEqual({
      leftOut: ["news"],
      leftOutKinds: ["probe"],
    })
    expect(leftOutQuery(new Set())).toEqual({ leftOut: [], leftOutKinds: [] })
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
    expect(statTotals(byKind, none, none)).toEqual({
      total: 20,
      useful: 6,
      idle: 7,
      wasted: 7,
      ledgerOnly: 0,
    })
  })

  test("the stat strip leaves out hidden kinds and outcomes", () => {
    expect(statTotals(byKind, new Set(["probe"]), hide("wasted"))).toEqual({
      total: 9,
      useful: 6,
      idle: 3,
      wasted: 0,
      ledgerOnly: 0,
    })
  })
})

describe("days before recording (RQS-16)", () => {
  // 40 auto sync Requests known from the ledger alone, beside 10 recorded.
  const auto = { ...totals("auto", 6, 3, 1, 50), requests: 50, ledgerOnly: 40 }

  test("the stat strip counts them in the Requests, under no outcome", () => {
    expect(statTotals([auto], none, none)).toEqual({
      total: 50,
      useful: 6,
      idle: 3,
      wasted: 1,
      ledgerOnly: 40,
    })
  })

  test("hiding outcomes never hides them: they have none", () => {
    const { rows } = kindRows([auto], none, hide("useful", "idle"))
    expect(rows.map((r) => [r.total, r.ledgerOnly, r.wasted])).toEqual([
      [41, 40, 1],
    ])
  })

  test("a hidden kind hides them with it", () => {
    const [account] = accountRows(
      [{ ...auto, accountId: "a", email: "a@example.com" }],
      new Set(["auto"]),
      none,
    )
    expect([account.total, account.ledgerOnly]).toEqual([0, 0])
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

const onAccount = (
  accountId: string,
  kind: string,
  useful: number,
  idle: number,
  wasted: number,
): AccountRequestTotals => ({
  ...totals(kind, useful, idle, wasted),
  accountId,
  email: `${accountId}@example.com`,
})

describe("the Accounts (RQS-05)", () => {
  const byAccount = [
    onAccount("a", "auto", 10, 5, 1),
    onAccount("a", "bulk", 4, 0, 0),
    onAccount("b", "auto", 30, 0, 2),
  ]

  test("each Account's Requests by kind, busiest first", () => {
    const rows = accountRows(byAccount, new Set(), new Set())
    expect(rows.map((r) => [r.id, r.email, r.total])).toEqual([
      ["b", "b@example.com", 32],
      ["a", "a@example.com", 20],
    ])
    expect(rows[1].byKind).toEqual({ auto: 16, bulk: 4 })
    expect(rows[1].wasted).toBe(1)
  })

  test("hidden kinds and outcomes leave the Accounts", () => {
    const rows = accountRows(byAccount, new Set(["auto"]), new Set(["useful"]))
    expect(rows.map((r) => [r.id, r.total])).toEqual([
      ["a", 0],
      ["b", 0],
    ])
    const shown = accountRows(byAccount, new Set(), new Set(["useful"]))
    expect(shown.find((r) => r.id === "a")?.byKind).toEqual({
      auto: 6,
      bulk: 0,
    })
  })

  test("a picked Account's total keeps its Uncharged Requests, its facet count only its spend", () => {
    // The tab with Account a picked: its sync, and a handle check it asked
    // for. The facet reads `byAccount`, which carries spend alone (ACW-01).
    const picked = [totals("auto", 10, 5, 1, 16), totals("handle", 0, 3, 0)]
    expect(statTotals(picked, none, none).total).toBe(19)
    const [a] = accountRows([onAccount("a", "auto", 10, 5, 1)], none, none)
    expect([a.total, a.byKind]).toEqual([16, { auto: 16 }])
  })

  test("an Account keeps its colour whichever are picked", () => {
    const every = ["a", "b", "c", "d", "e"]
    expect(accountColor("b", every)).toBe("var(--account-2)")
    expect(accountColor("e", every)).toBe("var(--account-1)")
  })

  // The ramp is violet, and so is Bot API (dataviz slot 7), which fails beside
  // --account-2. Picking Accounts shows their Bot API calls in the kind table,
  // which nothing paints in Account colours; the comparison, which is, keeps
  // its columns to charged kinds, so the two never share a chart (ACW-01).
  test("the comparison shows only charged kinds, never Bot API", () => {
    expect(COMPARE_KINDS.map((k) => k.id)).toEqual([
      "auto",
      "bulk",
      "single",
      "follow",
      "other",
    ])
  })
})

describe("since when a kind is off (RKD-02)", () => {
  const now = Date.parse("2026-10-28T18:00:00")

  test("today reads as a 24-hour clock alone", () => {
    expect(sinceLabel(Date.parse("2026-10-28T15:04:00"), now)).toBe("15:04")
  })

  test("an earlier day reads with its date, so it is not taken for today", () => {
    const label = sinceLabel(Date.parse("2026-10-27T15:04:00"), now)
    expect(label).toContain("27")
    expect(label).toEndWith(", 15:04")
  })
})
