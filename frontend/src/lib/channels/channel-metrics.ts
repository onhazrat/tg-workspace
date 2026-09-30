/**
 * The numbers a Channel filter can bound (CTB-02): how big and how active a
 * Channel is. Every value comes from what the Channels tab already loads, the
 * channel list, its stats and the in-Scope counts; nothing is fetched for it.
 * A Channel with no value for a number is not measured, and fails any bound
 * on it.
 */
import { formatCount } from "@/lib/format-count"
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
  /** Days are measured from here, the time the page loaded. */
  now: number
}

type Metric = {
  key: MetricKey
  label: string
  unit?: string
  value: (channel: Channel, inputs: MetricInputs) => number | null
}

const DAY = 86_400_000
const daysSince = (at: number | undefined, now: number) =>
  at ? (now - at) / DAY : null

/** In the Filters dropdown's order. The key is the URL form's word. */
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
    unit: "posts per hour",
    value: (c, i) => i.channelStats[c.name]?.velocity ?? null,
  },
  {
    key: "total_posts",
    label: "Total posts",
    value: (c, i) => i.channelStats[c.name]?.count ?? null,
  },
  {
    // Every Channel is measured: one outside the Scope has none in it.
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

const BY_KEY = new Map(METRICS.map((m) => [m.key, m]))

export const metric = (key: MetricKey): Metric => BY_KEY.get(key) as Metric

export const isMetricKey = (word: string): word is MetricKey =>
  BY_KEY.has(word as MetricKey)

export const metricValue = (
  key: MetricKey,
  channel: Channel,
  inputs: MetricInputs,
): number | null => metric(key).value(channel, inputs)

/** The measured values of a metric across `channels`, ascending. */
export const metricValues = (
  key: MetricKey,
  channels: Channel[],
  inputs: MetricInputs,
): number[] =>
  channels
    .map((c) => metricValue(key, c, inputs))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)

/**
 * A bound on one metric, either end open, or `none`: the Channels with no
 * value for it.
 */
export type MetricBound = { min?: number; max?: number; none?: true }

/** Which of the four shapes a bound has. */
export type BoundKind = "gte" | "lte" | "between" | "none"

export const boundKind = (b?: MetricBound): BoundKind =>
  b?.none
    ? "none"
    : b?.min !== undefined && b.max !== undefined
      ? "between"
      : b?.max !== undefined
        ? "lte"
        : "gte"

/** What a bound editor needs of the Account's Channels. */
export type MetricData = {
  /** A metric's measured values across the Account's Channels, ascending. */
  values: (key: MetricKey) => number[]
  /** Every Channel, measured or not. */
  total: number
}

/** A missing value fails every bound and passes only `none`. */
export function inBound(value: number | null, bound: MetricBound): boolean {
  if (bound.none) return value === null
  return (
    value !== null &&
    (bound.min === undefined || value >= bound.min) &&
    (bound.max === undefined || value <= bound.max)
  )
}

/** The bound alone, "≥ 1.2K", "500–20K" or "no value". */
export function boundText(b: MetricBound): string {
  const [min, max] = [formatCount(b.min ?? 0), formatCount(b.max ?? 0)]
  return {
    none: "no value",
    between: `${min}–${max}`,
    gte: `≥ ${min}`,
    lte: `≤ ${max}`,
  }[boundKind(b)]
}
