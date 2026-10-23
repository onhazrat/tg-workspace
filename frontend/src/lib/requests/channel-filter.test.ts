/** The Channel table's filter (RQS-04): kinds, Hide uncharged and measures. */
import { describe, expect, test } from "bun:test"
import type { ChannelRequestTotals } from "@/client"
import { setSwitch } from "@/lib/filter-tree"
import { channelRows, type Outcome } from "./breakdown"
import {
  addCond,
  type ChannelCond,
  criteria,
  emptyChannelFilter,
  isUncharged,
  keepRow,
  pickKind,
} from "./channel-filter"

const part = (
  channel: string | null,
  kind: string,
  [useful, idle, wasted]: [number, number, number],
  syncs = 0,
  failedSyncs = 0,
  newPosts = 0,
): ChannelRequestTotals => ({
  channel,
  kind,
  requests: useful + idle + wasted,
  useful,
  idle,
  wasted,
  charged: 0,
  newPosts,
  repeatedPosts: 0,
  syncs,
  failedSyncs,
})

const rows = channelRows(
  [
    part("news", "auto", [8, 2, 0], 5, 1, 40),
    part("news", "single", [1, 0, 1], 1, 0, 3),
    part("tech", "auto", [2, 2, 0], 2, 2, 0),
    part("quiet", "bulk", [0, 3, 0], 3, 0, 0),
    part(null, "probe", [400, 100, 500]),
  ],
  new Set(),
  new Set(),
)
const none = new Set<never>()
const kept = (
  filter = emptyChannelFilter(),
  hiddenKinds: ReadonlySet<string> = none,
  hiddenOutcomes: ReadonlySet<Outcome> = none,
) =>
  rows
    .filter(keepRow(filter, hiddenKinds, hiddenOutcomes))
    .map((r) => r.key)
    .sort()

describe("the Channel table's filter", () => {
  test("an empty filter keeps every row", () => {
    expect(kept()).toEqual(["news", "probe", "quiet", "tech"])
  })

  test("picking kinds keeps the rows with any of that work", () => {
    const single = pickKind(emptyChannelFilter(), "single")
    expect(kept(single)).toEqual(["news"])
    expect(kept(pickKind(single, "bulk"))).toEqual(["news", "quiet"])
    // Picking a kind again takes it away.
    expect(kept(pickKind(single, "single"))).toEqual(kept())
  })

  test("Hide uncharged leaves out the aggregate rows", () => {
    const hide = setSwitch(
      emptyChannelFilter(),
      isUncharged,
      { type: "uncharged" } as ChannelCond,
      true,
      true,
    )
    expect(kept(hide)).toEqual(["news", "quiet", "tech"])
  })

  test("a measure bounds the whole row or one kind of its work", () => {
    const failed = addCond(emptyChannelFilter(), {
      type: "measure",
      measure: "failed",
      bound: { min: 1 },
    })
    expect(kept(failed)).toEqual(["news", "tech"])
    const autoFailed = addCond(emptyChannelFilter(), {
      type: "measure",
      measure: "failed",
      kind: "auto",
      bound: { min: 2 },
    })
    expect(kept(autoFailed)).toEqual(["tech"])
    const yieldOver = addCond(emptyChannelFilter(), {
      type: "measure",
      measure: "postsPerReq",
      bound: { min: 1 },
    })
    expect(kept(yieldOver)).toEqual(["news"])
  })

  test("a Condition on a hidden kind or outcome stands aside", () => {
    const autoIdle = addCond(emptyChannelFilter(), {
      type: "measure",
      measure: "idle",
      kind: "auto",
      bound: { min: 100 },
    })
    expect(kept(autoIdle)).toEqual([])
    expect(kept(autoIdle, new Set(["auto"]))).toEqual(kept())
    expect(kept(autoIdle, none, new Set<Outcome>(["idle"]))).toEqual(kept())
  })

  test("the criteria offer every measure whole-row, and a sync's for a sync kind", () => {
    const [row, auto, probe] = criteria(["auto", "probe"], none)
    expect(row.heading).toBe("Whole row")
    expect(row.measures).toContain("syncs")
    expect(row.measures).toContain("postsPerReq")
    expect(auto.measures).toEqual(row.measures)
    expect(probe.measures).toEqual([
      "total",
      "idle",
      "wasted",
      "idleShare",
      "wasteShare",
    ])
    const [shown] = criteria([], new Set<Outcome>(["wasted"]))
    expect(shown.measures).not.toContain("wasted")
    expect(shown.measures).not.toContain("wasteShare")
  })
})
