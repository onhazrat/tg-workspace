/**
 * What the Requests tab's zoomable trend makes of the Trend (RQS-07). The
 * server keeps a tier per stretch (a day, an hour, or 5 minutes from each
 * Request); the trend re-sums them to about TARGET buckets across the view.
 * No React and no Plotly, so every rule is pinned by `zoom.test.ts`.
 */
import type { RequestTrendBucket } from "@/client"
import { MINUTE_MS } from "@/lib/analysis-window"
import { DAY_MS, HOUR_MS } from "@/lib/scope/window"
import {
  fmt,
  KINDS,
  kindMeta,
  OUTCOMES,
  type Outcome,
  rangeText,
  toggled,
} from "./breakdown"

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

/** Above this many times its 99th percentile, a row's tallest bucket stops setting its scale. */
export const SPIKE = 1.5
/** A capped scale stops this far above the 99th percentile. */
const CAP = 1.15

/**
 * A row's y scale from the buckets in view, so a burst out of view, or one
 * burst in it, does not flatten the rest. `cap` is where a burst's scale
 * stops; an empty or idle view stays flat rather than taking the whole
 * range's scale.
 */
export function scaleOf(view: readonly number[]) {
  const seen = [...view].sort((a, b) => a - b)
  const p99 = seen[Math.floor(0.99 * (seen.length - 1))] ?? 0
  const top = seen.at(-1) ?? 0
  const cap = p99 > 0 && top > SPIKE * p99 ? p99 * CAP : null
  const range: [number, number] = [0, cap ?? (top > 0 ? top * 1.05 : 1)]
  return { cap, range }
}

/**
 * How much of a kind's colour each outcome keeps, the rest the chart's
 * surface: the hue says which kind, the step what came of it.
 */
export const STEP: Record<Outcome, number> = {
  useful: 1,
  idle: 0.55,
  wasted: 0.3,
}

const channels = (hex: string) => {
  const h = hex.replace("#", "")
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * A kind's colour stepped toward the surface for an outcome, opaque, so the
 * tier bands behind do not shift its hue. The tokens are hex.
 */
export function shadeOf(kind: string, surface: string, outcome: Outcome) {
  const [k, s, share] = [channels(kind), channels(surface), STEP[outcome]]
  return `rgb(${k.map((v, i) => Math.round(v * share + s[i] * (1 - share))).join(",")})`
}

/** What a bucket of `span` adds up. */
export function grainOf(span: number) {
  if (span === FINE_MS) return "5-minute total, from each Request"
  if (span < HOUR_MS) return `${span / MINUTE_MS}-minute total`
  if (span === HOUR_MS) return "hourly total"
  return span < DAY_MS ? `${span / HOUR_MS}-hour total` : "daily total"
}

/** A slice of the Requests: one kind, one outcome, both, or (empty) all. */
export interface Part {
  kind?: string
  outcome?: Outcome
}

const NONE: ReadonlySet<never> = new Set()

/** A bucket's Requests in `part`, leaving out the kinds and outcomes hidden. */
function countOf(
  pt: Point,
  hiddenKinds: ReadonlySet<string>,
  hiddenOutcomes: ReadonlySet<Outcome>,
  part: Part = {},
) {
  let n = 0
  for (const [key, count] of Object.entries(pt.counts)) {
    const [kind, outcome] = key.split(":") as [string, Outcome]
    if (
      (part.kind ?? kind) === kind &&
      (part.outcome ?? outcome) === outcome &&
      !hiddenKinds.has(kind) &&
      !hiddenOutcomes.has(outcome)
    )
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
    /** Each point's instant, epoch ms. */
    t: x,
    x: x.map(toPlotly),
    y,
    hover,
  }
}

/**
 * How the trend shows a dimension: merged, stacked in a row's area, or a row
 * per value on its own scale.
 */
export type Split = "off" | "stacked" | "separate"
export interface Splits {
  kind: Split
  outcome: Split
}
type Dimension = keyof Part

/** The kinds with Requests in `points`, in the tab's order, unknown ones last. */
function kindsIn(points: readonly Point[]) {
  const ids = new Set(
    points.flatMap((pt) => Object.keys(pt.counts).map((k) => k.split(":")[0])),
  )
  const rank = (id: string) => {
    const i = KINDS.findIndex((k) => k.id === id)
    return i < 0 ? KINDS.length : i
  }
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** Every value of the dimensions switched on, crossed; one empty part if none. */
function product(kinds: readonly string[], kind: boolean, outcome: boolean) {
  const ks = kind ? kinds : [undefined]
  const os = outcome ? OUTCOMES.map((o) => o.id) : [undefined]
  return ks.flatMap((k) => os.map((o): Part => ({ kind: k, outcome: o })))
}

export function labelOf(part: Part) {
  const outcome = OUTCOMES.find((o) => o.id === part.outcome)
  return (
    [part.kind && kindMeta(part.kind).label, outcome?.label]
      .filter(Boolean)
      .join(" · ") || "All Requests"
  )
}

/** The dimension the legend lists: the one stacked, kinds first. */
const legendOf = (s: Splits): Dimension | null =>
  s.kind === "stacked" ? "kind" : s.outcome === "stacked" ? "outcome" : null

/**
 * The trend's rows and their series for the switches. A stacked dimension
 * splits a row's area; a separate one gives a row per value; the rows share
 * the x axis. A value hidden in the legend's dimension stays listed, empty,
 * to show again; one hidden elsewhere leaves the chart. Each row's scale
 * comes from its buckets in view, and a bucket above a capped scale gets a
 * notch carrying its real total.
 */
export function trendChart(
  points: readonly Point[],
  size: number,
  [from, to]: [number, number],
  splits: Splits,
  hiddenKinds: ReadonlySet<string>,
  hiddenOutcomes: ReadonlySet<Outcome>,
) {
  const line = trendLine(points, size, hiddenKinds, hiddenOutcomes)
  const kinds = kindsIn(points)
  const legend = legendOf(splits)
  const hiddenIn = (p: Part, d: Dimension) =>
    d === "kind"
      ? !!p.kind && hiddenKinds.has(p.kind)
      : !!p.outcome && hiddenOutcomes.has(p.outcome)
  const listed = (p: Part) =>
    points.some((pt) => countOf(pt, NONE, NONE, p) > 0) &&
    (["kind", "outcome"] as const).every((d) => d === legend || !hiddenIn(p, d))
  const yOf = (p: Part) => {
    const y = points.map(
      (pt) => (countOf(pt, hiddenKinds, hiddenOutcomes, p) * HOUR_MS) / pt.span,
    )
    return line.y.length > y.length ? [...y, 0] : y
  }
  const stack = product(
    kinds,
    splits.kind === "stacked",
    splits.outcome === "stacked",
  )
  const rows = product(
    kinds,
    splits.kind === "separate",
    splits.outcome === "separate",
  ).map((row) => {
    const series = stack
      .map(
        (s): Part => ({
          kind: s.kind ?? row.kind,
          outcome: s.outcome ?? row.outcome,
        }),
      )
      .filter(listed)
      .map((part) => ({
        part,
        name: labelOf(legend ? { [legend]: part[legend] } : part),
        group: legend ? part[legend] : undefined,
        off: !!legend && hiddenIn(part, legend),
        y: yOf(part),
      }))
    const totals = line.y.map((_, i) =>
      series.reduce((sum, s) => sum + s.y[i], 0),
    )
    const { cap, range } = scaleOf(
      totals.filter((_, i) => line.t[i] >= from && line.t[i] <= to),
    )
    const notches = totals.flatMap((total, i) =>
      cap !== null && total > cap ? [{ x: line.x[i], total }] : [],
    )
    return { name: labelOf(row), series, cap, range, notches }
  })
  return {
    shape: line.shape,
    x: line.x,
    hover: line.hover,
    legend,
    kinds,
    rows: rows.filter((r) => r.series.length > 0),
  }
}

/** What the legend switches: the tab's own hidden kinds and outcomes. */
export interface Hidden {
  hiddenKinds: ReadonlySet<string>
  hiddenOutcomes: ReadonlySet<Outcome>
}

/**
 * A legend click as an update of the tab's hidden kinds or outcomes: the
 * kind table's Show box, or the outcome chip, whose last one shown stays.
 * An update, not a value: Plotly fires a click on each half of a double
 * click, and may still hold the handler of a render before.
 */
export const legendClick =
  (dim: Dimension, id: string) =>
  (h: Hidden): Partial<Hidden> => {
    if (dim === "kind") return { hiddenKinds: toggled(h.hiddenKinds, id) }
    const lastShown =
      !h.hiddenOutcomes.has(id as Outcome) &&
      h.hiddenOutcomes.size === OUTCOMES.length - 1
    return {
      hiddenOutcomes: lastShown
        ? new Set(h.hiddenOutcomes)
        : toggled(h.hiddenOutcomes, id as Outcome),
    }
  }

/** Every other of `all` hidden; or, if `id` was already alone, none. */
function isolated<T>(all: readonly T[], id: T, hidden: ReadonlySet<T>) {
  const alone = !hidden.has(id) && all.every((v) => v === id || hidden.has(v))
  return new Set(alone ? [] : all.filter((v) => v !== id))
}

/** A legend double click: that one alone, or everything again. */
export const legendDoubleClick =
  (dim: Dimension, id: string, kinds: readonly string[]) =>
  (h: Hidden): Partial<Hidden> =>
    dim === "kind"
      ? { hiddenKinds: isolated(kinds, id, h.hiddenKinds) }
      : {
          hiddenOutcomes: isolated(
            OUTCOMES.map((o) => o.id),
            id as Outcome,
            h.hiddenOutcomes,
          ),
        }
