/**
 * The Spread's arithmetic (ADR-037), no React: the one binning rule for
 * Spreads built in the browser, the median, two-figure rounding, and what a
 * pick on a number's Spread means as a Number bound. The Spread itself is
 * `components/Spread.tsx`.
 */
import { floorToMinute, MINUTE_MS } from "@/lib/analysis-window"
import type { MetricBound } from "@/lib/channels/channel-metrics"

/** Bars in a spread, as many as the server draws. */
export const BINS = 32

export type Range = [number, number]

/** One bar: what it counts from its low edge to its high one. */
export type SpreadBar = { lo: number; hi: number; count: number }

/** What a run of bars picked, in the Spread's values. */
export type Pick = {
  /** `undefined`: the low end is open. */
  min?: number
  /** `undefined`: the high end is open. */
  max?: number
  /** The run touched both ends of the whole Spread: everything with a value. */
  all: boolean
  /** The bars it covered. */
  run: { from: number; to: number }
}

/** The upper middle of sorted values. */
export const median = (sorted: number[]) =>
  sorted[Math.floor(sorted.length / 2)]

/** Two significant figures, so a picked edge reads 1,200 and not 1,187.43. */
export const nice = (v: number) => Number(v.toPrecision(2))

/**
 * Sorted values as 32 bars over the zoom's `range`, or the whole spread
 * without one (TB-04). Counts such as subscribers span orders of magnitude,
 * so past a hundredfold the axis is logarithmic, or nearly every value would
 * land in the first bar; a range starting at 0 is drawn on log(1 + x), since
 * log 0 has no place. A zoom keeps the whole spread's scale. Moments are
 * linear and binned by their minute, from the first minute to one past the
 * last, so the values sharing a minute share a bar.
 */
export function binSpread(
  sorted: number[],
  range: Range | null,
  { moments = false } = {},
) {
  const lo = sorted[0]
  const hi = sorted[sorted.length - 1]
  const log = !moments && lo >= 0 && hi / (lo > 0 ? lo : 1) > 100
  const [a, b] = moments
    ? [
        floorToMinute((range ?? [lo, hi])[0]),
        floorToMinute((range ?? [lo, hi])[1]) + MINUTE_MS,
      ]
    : (range ?? [lo, hi])
  const identity = (x: number) => x
  const f = !log ? identity : a > 0 ? Math.log : Math.log1p
  const inv = !log ? identity : a > 0 ? Math.exp : Math.expm1
  const span = f(b) - f(a)
  const edge = (i: number) =>
    i === 0 ? a : i === BINS ? b : inv(f(a) + (span * i) / BINS)
  const at = (v: number) => (moments ? floorToMinute(v) : v)
  const barOf = (value: number): number | null => {
    const v = at(value)
    if (v < a || v > b || (moments && v === b)) return null
    const i = span === 0 ? 0 : Math.floor(((f(v) - f(a)) / span) * BINS)
    return Math.min(BINS - 1, i)
  }
  const bars: SpreadBar[] = Array.from({ length: BINS }, (_, i) => ({
    lo: edge(i),
    hi: edge(i + 1),
    count: 0,
  }))
  for (const v of sorted) {
    const i = barOf(v)
    if (i !== null) bars[i].count++
  }
  return { bars, lo, hi, log, median: median(sorted), barOf }
}

/**
 * A pick as a Number bound, each end it sets rounded to two figures. Both
 * ends open keeps everything with a value: the whole spread's low end,
 * exactly, so the lowest value is kept too.
 */
export function pickBound(p: Pick, lo: number): MetricBound {
  if (p.all) return { min: lo }
  return {
    ...(p.min !== undefined && { min: nice(p.min) }),
    ...(p.max !== undefined && { max: nice(p.max) }),
  }
}
