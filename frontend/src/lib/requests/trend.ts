/**
 * What the Requests tab's daily bars make of the Trend (RQS-06). The server
 * sends buckets at the finest tier it keeps for each stretch: 5 minutes, an
 * hour or a day, in naive UTC. No React, so every rule is pinned by
 * `trend.test.ts`.
 */
import type { RequestTrendBucket } from "@/client"
import { DAY_MS, HOUR_MS } from "@/lib/scope/window"
import type { Outcome } from "./breakdown"

export interface Bar {
  /** The bar's first instant, epoch ms. */
  at: number
  /** Its label: the UTC day, or the UTC hour on a one-day range. */
  x: string
  charged: number
  uncharged: number
}

/** The server's times are UTC without a zone. */
const utcMs = (naive: string) => Date.parse(`${naive}Z`)

const floorTo = (ms: number, step: number) => ms - (ms % step)

const label = (ms: number, step: number) =>
  step === DAY_MS
    ? new Date(ms).toISOString().slice(0, 10)
    : new Date(ms).toISOString().slice(11, 16)

/**
 * One bar per UTC day of the range, Charged and Uncharged apart, or one per
 * hour when the range is a day or less. `dailyOnly` says such a day is past
 * the hourly totals, so only its daily total is kept and no hours can be
 * drawn. Hidden kinds and outcomes add nothing.
 */
export function dailyBars(
  buckets: readonly RequestTrendBucket[],
  range: { start: number; end: number },
  hiddenKinds: ReadonlySet<string>,
  hiddenOutcomes: ReadonlySet<Outcome>,
): { grain: "day" | "hour"; bars: Bar[]; dailyOnly: boolean } {
  const hourly = range.start > 0 && range.end - range.start <= DAY_MS
  const step = hourly ? HOUR_MS : DAY_MS
  const shown = buckets.filter((b) => !hiddenKinds.has(b.kind))
  const first = range.start || Math.min(...shown.map((b) => utcMs(b.start)))
  const bars = new Map<number, Bar>()
  for (let t = floorTo(first, step); t < range.end; t += step)
    bars.set(t, { at: t, x: label(t, step), charged: 0, uncharged: 0 })
  let dailyOnly = false
  for (const b of shown) {
    const [lo, hi] = [utcMs(b.start), utcMs(b.end)]
    // A day's total is widened to its midnight, wherever the range starts.
    dailyOnly ||= hourly && hi - lo > HOUR_MS && hi > range.start
    const bar = bars.get(floorTo(lo, step))
    if (!bar) continue
    const n = (["useful", "idle", "wasted"] as const)
      .filter((o) => !hiddenOutcomes.has(o))
      .reduce((sum, o) => sum + b[o], 0)
    bar[b.charged ? "charged" : "uncharged"] += n
  }
  return { grain: hourly ? "hour" : "day", bars: [...bars.values()], dailyOnly }
}
