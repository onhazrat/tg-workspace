/**
 * What the Requests tab's zoomable trend makes of the Trend (RQS-07). The
 * server keeps a tier per stretch (a day, an hour, or 5 minutes from each
 * Request); the trend re-sums them to about TARGET buckets across the view.
 * No React and no Plotly, so every rule is pinned by `zoom.test.ts`.
 */
import type { RequestTrendBucket } from "@/client"
import { MINUTE_MS } from "@/lib/analysis-window"
import { DAY_MS, HOUR_MS } from "@/lib/scope/window"
import { fmt, OUTCOMES, type Outcome, rangeText } from "./breakdown"

export const FINE_MS = 5 * MINUTE_MS

/** The bucket sizes the trend steps through as the zoom changes, UTC-aligned. */
const SIZES = [
  FINE_MS,
  15 * MINUTE_MS,
  30 * MINUTE_MS,
  HOUR_MS,
  2 * HOUR_MS,
  4 * HOUR_MS,
  6 * HOUR_MS,
  12 * HOUR_MS,
  DAY_MS,
]
/** Buckets across the visible range: about one per 3 to 4 px of the plot. */
const TARGET = 220

/** One bucket: its first instant, its span, and its Requests by `kind:outcome`. */
export interface Point {
  t: number
  span: number
  counts: Record<string, number>
}

/** The server's times are UTC without a zone. */
const utcMs = (naive: string) => Date.parse(`${naive}Z`)

/**
 * The tier a bucket was kept at, from its span. Tier edges fall on the hour
 * and the day, so only a 5-minute bucket the range cuts is shorter than its tier.
 */
export const tierOf = (span: number) =>
  span > HOUR_MS ? DAY_MS : span > FINE_MS ? HOUR_MS : FINE_MS

/** The server's buckets, each kind and Charged or not folded into one point per instant. */
export function storedBuckets(buckets: readonly RequestTrendBucket[]): Point[] {
  const points = new Map<number, Point>()
  for (const b of buckets) {
    const t = utcMs(b.start)
    const pt = points.get(t) ?? {
      t,
      span: tierOf(utcMs(b.end) - t),
      counts: {},
    }
    for (const o of OUTCOMES) {
      const key = `${b.kind}:${o.id}`
      pt.counts[key] = (pt.counts[key] ?? 0) + b[o.id]
    }
    points.set(t, pt)
  }
  return [...points.values()].sort((a, b) => a.t - b.t)
}

/**
 * The points re-summed into the finest size that keeps about TARGET of them
 * between `from` and `to`. Sums, never averages, so a bucket's count is
 * exact; a stretch kept coarser than the size stays at its own tier.
 */
export function rebucket(points: readonly Point[], from: number, to: number) {
  const size = SIZES.find((s) => (to - from) / s <= TARGET) ?? DAY_MS
  const out = new Map<number, Point>()
  for (const pt of points) {
    const span = Math.max(size, pt.span)
    const t = Math.floor(pt.t / span) * span
    const b = out.get(t) ?? { t, span, counts: {} }
    for (const [k, n] of Object.entries(pt.counts))
      b.counts[k] = (b.counts[k] ?? 0) + n
    out.set(t, b)
  }
  return { size, points: [...out.values()].sort((a, b) => a.t - b.t) }
}

const TIER_LABELS = new Map([
  [DAY_MS, "daily totals"],
  [HOUR_MS, "hourly totals"],
  [FINE_MS, "each Request"],
])

/**
 * The tiers kept between `lo` and `hi`, as bands behind the trend. The tiers
 * run oldest to finest, so each band ends where the next tier's first bucket
 * starts; the first starts at `lo` and the last ends at `hi`.
 */
export function tierBands(points: readonly Point[], lo: number, hi: number) {
  const starts = new Map<number, number>()
  for (const pt of points) if (!starts.has(pt.span)) starts.set(pt.span, pt.t)
  const tiers = [...starts]
  return tiers.map(([span], i) => ({
    x0: i === 0 ? lo : tiers[i][1],
    x1: tiers[i + 1]?.[1] ?? hi,
    label: TIER_LABELS.get(span) ?? "",
  }))
}

/** A band's name shows when it spans more than this share of the view. */
const LABELLED = 0.08

/** The names of the bands wide in the view `from` to `to`, each where the view first shows it. */
export function bandLabels(
  bands: ReturnType<typeof tierBands>,
  from: number,
  to: number,
) {
  return bands
    .map((b) => ({ x: Math.max(b.x0, from), end: Math.min(b.x1, to), b }))
    .filter(({ x, end }) => (end - x) / (to - from) > LABELLED)
    .map(({ x, b }) => ({ x, text: b.label }))
}

/**
 * Plotly draws a timestamp in the browser's time zone but a date string with
 * no zone as written. So every time goes to Plotly as a zoneless UTC string,
 * and the axis, the hover and the ranges it hands back all read in UTC.
 */
export const toPlotly = (ms: number) => new Date(ms).toISOString().slice(0, 23)
export const fromPlotly = (v: string | number) =>
  typeof v === "number" ? v : utcMs(v.replace(" ", "T"))

/** What a bucket of `span` adds up. */
export function grainOf(span: number) {
  if (span === FINE_MS) return "5-minute total, from each Request"
  if (span < HOUR_MS) return `${span / MINUTE_MS}-minute total`
  if (span === HOUR_MS) return "hourly total"
  return span < DAY_MS ? `${span / HOUR_MS}-hour total` : "daily total"
}

/** A bucket's Requests, leaving out the kinds and outcomes hidden. */
function countOf(
  pt: Point,
  hiddenKinds: ReadonlySet<string>,
  hiddenOutcomes: ReadonlySet<Outcome>,
) {
  let n = 0
  for (const [key, count] of Object.entries(pt.counts)) {
    const [kind, outcome] = key.split(":")
    if (!hiddenKinds.has(kind) && !hiddenOutcomes.has(outcome as Outcome))
      n += count
  }
  return n
}

/**
 * The buckets as one line in Requests per hour, so a day and five minutes
 * share an axis; the hover keeps each bucket's own count. Buckets of 30
 * minutes or more are a spline through their middles; finer ones are steps
 * held from start to end, where a curve would claim the rate moved smoothly
 * inside five minutes.
 */
export function trendLine(
  points: readonly Point[],
  size: number,
  hiddenKinds: ReadonlySet<string>,
  hiddenOutcomes: ReadonlySet<Outcome>,
) {
  const smooth = size >= 30 * MINUTE_MS
  const counts = points.map((pt) => countOf(pt, hiddenKinds, hiddenOutcomes))
  const x = points.map((pt) => (smooth ? pt.t + pt.span / 2 : pt.t))
  const y = points.map((pt, i) => (counts[i] * HOUR_MS) / pt.span)
  const hover = points.map(
    (pt, i) =>
      `${rangeText(pt.t, pt.t + pt.span)} UTC<br>${grainOf(pt.span)} · ${fmt(counts[i])} Requests`,
  )
  const last = points.at(-1)
  if (!smooth && last) {
    x.push(last.t + last.span)
    y.push(0)
    hover.push("")
  }
  return {
    shape: smooth ? ("spline" as const) : ("hv" as const),
    x: x.map(toPlotly),
    y,
    hover,
  }
}
