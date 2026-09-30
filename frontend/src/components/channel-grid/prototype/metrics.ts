/**
 * PROTOTYPE, throwaway: the numeric criteria a channel can be filtered on, and
 * the filter itself. Each value comes from a field the card already shows.
 */
import type { Channel, ChannelStats } from "@/types"

export type MetricKey =
  | "subscribers"
  | "reach"
  | "activity_rate"
  | "total_posts"
  | "posts_in_scope"
  | "days_since_update"
  | "days_followed"
  | "photos"
  | "videos"
  | "files"
  | "links"

export type MetricInputs = {
  channelStats: Record<string, ChannelStats>
  postsInScopeCounts: Record<string, number>
  now: number
}

type Metric = {
  key: MetricKey
  label: string
  unit?: string
  /** null = not measured; such a channel fails any bound on the metric. */
  value: (c: Channel, inputs: MetricInputs) => number | null
}

const DAY = 86_400_000
const daysSince = (ts: number | undefined, now: number) =>
  ts ? (now - ts) / DAY : null

export const METRICS: Metric[] = [
  {
    key: "subscribers",
    label: "Subscribers",
    value: (c) => c.subscribers ?? null,
  },
  {
    key: "reach",
    label: "Reach",
    value: (c, i) => i.channelStats[c.name]?.reach ?? null,
  },
  {
    key: "activity_rate",
    label: "Activity rate",
    unit: "posts/hr",
    value: (c, i) => i.channelStats[c.name]?.velocity ?? null,
  },
  {
    key: "total_posts",
    label: "Total posts",
    value: (c, i) => i.channelStats[c.name]?.count ?? null,
  },
  {
    key: "posts_in_scope",
    label: "Posts in scope",
    value: (c, i) => i.postsInScopeCounts[c.name] ?? 0,
  },
  {
    key: "days_since_update",
    label: "Days since last update",
    unit: "days",
    value: (c, i) => daysSince(c.lastUpdated, i.now),
  },
  {
    key: "days_followed",
    label: "Days followed",
    unit: "days",
    value: (c, i) => daysSince(c.followedAt, i.now),
  },
  { key: "photos", label: "Photos", value: (c) => c.photos ?? null },
  { key: "videos", label: "Videos", value: (c) => c.videos ?? null },
  { key: "files", label: "Files", value: (c) => c.files ?? null },
  { key: "links", label: "Links", value: (c) => c.links ?? null },
]

export const metric = (key: MetricKey) =>
  METRICS.find((m) => m.key === key) as Metric

/** A bound on one metric. Either end may be open. */
export type NumericFilter = {
  metric: MetricKey
  min?: number
  max?: number
}

export function passesNumericFilters(
  c: Channel,
  filters: NumericFilter[],
  inputs: MetricInputs,
): boolean {
  return filters.every((f) => {
    const v = metric(f.metric).value(c, inputs)
    if (v === null) return f.min === undefined && f.max === undefined
    return (
      (f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max)
    )
  })
}

/** Sorted known values of a metric across channels, for ranges and percentiles. */
export function metricValues(
  key: MetricKey,
  channels: Channel[],
  inputs: MetricInputs,
): number[] {
  return channels
    .map((c) => metric(key).value(c, inputs))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)
}

export const quantile = (sorted: number[], q: number) =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]

export function formatNumber(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)}k`
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`
  if (Number.isInteger(v)) return String(v)
  return v < 10 ? v.toFixed(2) : v.toFixed(0)
}

export function describeFilter(f: NumericFilter): string {
  const m = metric(f.metric)
  if (f.min !== undefined && f.max !== undefined)
    return `${m.label} ${formatNumber(f.min)}–${formatNumber(f.max)}`
  if (f.min !== undefined) return `${m.label} ≥ ${formatNumber(f.min)}`
  if (f.max !== undefined) return `${m.label} ≤ ${formatNumber(f.max)}`
  return m.label
}
