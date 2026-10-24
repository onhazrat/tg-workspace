/**
 * The range picker's spread (RQS-09): when Requests were made, over
 * everything kept. The server sends hours inside the hourly span and whole
 * days before it, in naive UTC; the bars are binned here, so zooming and
 * panning never ask again. No React, so every rule is pinned by
 * `spread.test.ts`.
 */
import type { RequestSpreadBucket } from "@/client"
import { DAY_MS, HOUR_MS } from "@/lib/scope/window"

export type SpreadBin = { lo: number; hi: number; count: number }

export interface RequestedSpread {
  /** The whole spread's ends, epoch ms, zoomed or not. */
  min: number
  max: number
  /** The instant half the Requests were made before. */
  median: number
  total: number
  bins: SpreadBin[]
}

const utcMs = (naive: string) => Date.parse(`${naive}Z`)

/**
 * One bar per UTC day, or per hour once under two days show, so a picked
 * run of bars is exactly whole days or hours. A bucket counts at its start,
 * so a day kept only whole lands on its midnight. `null` with nothing kept.
 */
export function requestedSpread(
  buckets: readonly RequestSpreadBucket[],
  zoom: [number, number] | null,
): RequestedSpread | null {
  if (!buckets.length) return null
  const points = buckets
    .map((b) => ({ at: utcMs(b.start), n: b.requests }))
    .sort((a, b) => a.at - b.at)
  const min = points[0].at
  const max = Math.max(...buckets.map((b) => utcMs(b.end)))
  const total = points.reduce((sum, p) => sum + p.n, 0)
  let seen = 0
  const median = points.find((p) => (seen += p.n) >= total / 2)?.at ?? min
  const [a, b] = zoom ?? [min, max]
  const width = b - a >= 2 * DAY_MS ? DAY_MS : HOUR_MS
  const lo = Math.floor(a / width) * width
  const bins = Array.from(
    { length: Math.max(1, Math.ceil((b - lo) / width)) },
    (_, i) => ({ lo: lo + i * width, hi: lo + (i + 1) * width, count: 0 }),
  )
  for (const p of points) {
    const bin = bins[Math.floor((p.at - lo) / width)]
    if (bin) bin.count += p.n
  }
  return { min, max, median, total, bins }
}

/**
 * Where each tier's history ends, inside `[lo, hi]`: before the first line
 * no single Requests are kept, before the second no hours.
 */
export function tierEdges(
  now: number,
  recordDays: number,
  hourlyDays: number,
  lo: number,
  hi: number,
): { at: number; label: string }[] {
  return [
    { at: now - recordDays * DAY_MS, label: `${recordDays}d · each Request` },
    { at: now - hourlyDays * DAY_MS, label: `${hourlyDays}d · hourly` },
  ].filter((e) => e.at > lo && e.at < hi)
}

/** The zoom moved `by` ms, its span kept, inside `[min, max]`. */
export function panned(
  [a, b]: [number, number],
  by: number,
  min: number,
  max: number,
): [number, number] {
  const start = Math.min(Math.max(a + by, min), max - (b - a))
  return [start, start + (b - a)]
}
