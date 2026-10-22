/**
 * What the Requests tab makes of the Breakdown (RQS-03, ADR-035): the kind
 * table, the Channel table, the totals and the range. No React, so every rule
 * is pinned by `breakdown.test.ts`.
 */
import type { ChannelRequestTotals, RequestTotals } from "@/client"
import { floorToMinute } from "@/lib/analysis-window"
import { DAY_MS } from "@/lib/scope/window"
import { resolveTimeBound, type TimeBound } from "@/lib/time-bound/bound"

export type Outcome = "useful" | "idle" | "wasted"
export type ChargedFilter = "all" | "charged" | "uncharged"

export const OUTCOMES: { id: Outcome; label: string }[] = [
  { id: "useful", label: "Useful" },
  { id: "idle", label: "Idle" },
  { id: "wasted", label: "Wasted" },
]

/**
 * What every part of the tab reads (spec, "Tab-wide state"). One value, so
 * the trend and the tables hide the same kinds and outcomes; the Accounts and
 * the Channels left out join it in later tickets.
 */
export interface RequestsFilter {
  bound: TimeBound
  charged: ChargedFilter
  hiddenKinds: ReadonlySet<string>
  hiddenOutcomes: ReadonlySet<Outcome>
}

export const initialRequestsFilter = (): RequestsFilter => ({
  bound: { mode: "live", start: -30 * DAY_MS },
  charged: "all",
  hiddenKinds: new Set(),
  hiddenOutcomes: new Set(),
})

/** `set` with `item` flipped in or out. */
export function toggled<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set)
  if (!next.delete(item)) next.add(item)
  return next
}

export interface KindMeta {
  id: string
  label: string
  /** Whether a Budget pays for this work; the kind table marks the rest. */
  charged: boolean
}

/** Every kind of work the spec names, in its colour order. */
export const KINDS: KindMeta[] = [
  { id: "auto", label: "Auto sync", charged: true },
  { id: "bulk", label: "Manual bulk", charged: true },
  { id: "single", label: "Manual single", charged: true },
  { id: "follow", label: "Follow", charged: true },
  { id: "probe", label: "Directory probe", charged: false },
  { id: "handle", label: "Handle check", charged: false },
  { id: "botApi", label: "Bot API", charged: false },
  { id: "other", label: "Other", charged: true },
]

/** A kind the server knows and this build does not is named by its id. */
export function kindMeta(id: string): KindMeta {
  return KINDS.find((k) => k.id === id) ?? { id, label: id, charged: true }
}

/** Work with no Channel shows as one row per kind (spec, tab decision 7). */
const AGGREGATE_LABEL: Record<string, string> = {
  probe: "Directory probes",
  handle: "Handle checks",
}

export interface Tally {
  total: number
  useful: number
  idle: number
  wasted: number
}

const emptyTally = (): Tally => ({ total: 0, useful: 0, idle: 0, wasted: 0 })

/** Adds `row`'s shown outcomes to `into`; a hidden one adds nothing. */
function addTo(into: Tally, row: Tally, hidden: ReadonlySet<Outcome>) {
  for (const { id } of OUTCOMES) {
    if (hidden.has(id)) continue
    into[id] += row[id]
    into.total += row[id]
  }
}

const tallyOf = (row: RequestTotals, hidden: ReadonlySet<Outcome>) => {
  const t = emptyTally()
  addTo(t, { ...row, total: row.requests }, hidden)
  return t
}

export interface KindRow extends Tally {
  kind: KindMeta
  hidden: boolean
  /** Of the shown kinds' Requests; null on a hidden kind. */
  share: number | null
}

/** The kind table, busiest first, and the busiest shown kind for the bars. */
export function kindRows(
  byKind: readonly RequestTotals[],
  hiddenKinds: ReadonlySet<string>,
  hiddenOutcomes: ReadonlySet<Outcome>,
): { rows: KindRow[]; max: number } {
  const tallies = byKind.map((row) => ({
    kind: kindMeta(row.kind),
    hidden: hiddenKinds.has(row.kind),
    ...tallyOf(row, hiddenOutcomes),
  }))
  const shown = tallies.filter((t) => !t.hidden)
  const grand = shown.reduce((sum, t) => sum + t.total, 0)
  const rows = tallies
    .map((t) => ({
      ...t,
      share: t.hidden ? null : grand ? t.total / grand : 0,
    }))
    .sort((a, b) => b.total - a.total)
  return { rows, max: Math.max(0, ...shown.map((t) => t.total)) }
}

export interface ChannelRow extends Tally {
  /** The handle, or the aggregate row's kind. */
  key: string
  /** What the table shows and the search reads: `@handle`, or a row name. */
  label: string
  /** The name sorting by Channel uses: the handle without its `@`. */
  name: string
  aggregate: boolean
  /** The kind that spent most on this row, for its swatch. */
  mainKind: string
}

/** One row per Channel, the work with no Channel as a row per kind. */
export function channelRows(
  byChannel: readonly ChannelRequestTotals[],
  hiddenKinds: ReadonlySet<string>,
  hiddenOutcomes: ReadonlySet<Outcome>,
): ChannelRow[] {
  const rows = new Map<string, ChannelRow & { byKind: Map<string, number> }>()
  for (const part of byChannel) {
    if (hiddenKinds.has(part.kind)) continue
    const aggregate = part.channel === null
    const key = part.channel ?? part.kind
    const name =
      part.channel ??
      AGGREGATE_LABEL[part.kind] ??
      `${kindMeta(part.kind).label}, no Channel`
    const row = rows.get(`${aggregate}:${key}`) ?? {
      ...emptyTally(),
      key,
      name,
      label: aggregate ? name : `@${name}`,
      aggregate,
      mainKind: part.kind,
      byKind: new Map(),
    }
    const tally = tallyOf(part, hiddenOutcomes)
    addTo(row, tally, new Set())
    row.byKind.set(part.kind, (row.byKind.get(part.kind) ?? 0) + tally.total)
    rows.set(`${aggregate}:${key}`, row)
  }
  return [...rows.values()]
    .filter((r) => r.total > 0)
    .map(({ byKind, ...row }) => ({
      ...row,
      mainKind: [...byKind].sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.total - a.total)
}

/** Rows the Requests tab's Channel table shows first. */
export const FIRST_CHANNELS = 25
/** Rows each "Show more" adds to the Requests tab's Channel table. */
export const MORE_CHANNELS = 50

export type ChannelSort =
  | "channel"
  | "total"
  | "idle"
  | "wasted"
  | "idleShare"
  | "wasteShare"
export type SortDirection = "asc" | "desc"

/** The Channel table's number columns; `outcome` names the one it is about. */
const CHANNEL_COLUMNS: {
  key: Exclude<ChannelSort, "channel">
  label: string
  outcome?: Outcome
}[] = [
  { key: "total", label: "Requests" },
  { key: "idle", label: "Idle", outcome: "idle" },
  { key: "wasted", label: "Wasted", outcome: "wasted" },
  { key: "idleShare", label: "Idle %", outcome: "idle" },
  { key: "wasteShare", label: "Wasted %", outcome: "wasted" },
]

/** The columns left once a hidden outcome takes its own away. */
export const channelColumns = (hidden: ReadonlySet<Outcome>) =>
  CHANNEL_COLUMNS.filter((c) => !c.outcome || !hidden.has(c.outcome))

const share = (part: number, whole: number) => (whole ? part / whole : 0)

const MEASURE: Record<Exclude<ChannelSort, "channel">, (r: Tally) => number> = {
  total: (r) => r.total,
  idle: (r) => r.idle,
  wasted: (r) => r.wasted,
  idleShare: (r) => share(r.idle, r.total),
  wasteShare: (r) => share(r.wasted, r.total),
}

/** The rows a search keeps, in the order picked. */
export function listChannels(
  rows: readonly ChannelRow[],
  search: string,
  sort: ChannelSort,
  direction: SortDirection,
): ChannelRow[] {
  const words = search.trim().toLowerCase().replace(/^@/, "")
  const sign = direction === "desc" ? -1 : 1
  return rows
    .filter((r) => r.name.toLowerCase().includes(words))
    .sort((a, b) =>
      sort === "channel"
        ? sign * a.name.localeCompare(b.name)
        : sign * (MEASURE[sort](a) - MEASURE[sort](b)),
    )
}

/** The filter bar's choice counts, from the unfiltered Breakdown. */
export function chargedCounts(byKind: readonly RequestTotals[]) {
  const all = byKind.reduce((sum, k) => sum + k.requests, 0)
  const charged = byKind.reduce((sum, k) => sum + k.charged, 0)
  return { all, charged, uncharged: all - charged }
}

/** The stat strip: every kind's Requests by outcome. */
export function statTotals(byKind: readonly RequestTotals[]): Tally {
  const t = emptyTally()
  for (const row of byKind) addTo(t, { ...row, total: row.requests }, new Set())
  return t
}

/**
 * The bound as the instants the Breakdown takes, cut to the minute as the
 * server cuts them. An open start reads everything kept; an open end, now.
 */
export function requestsRange(bound: TimeBound, now: number) {
  const { start, end } = resolveTimeBound(bound, now)
  return {
    start: start === undefined ? 0 : floorToMinute(start),
    end: floorToMinute(end ?? now),
  }
}

const utcMinute = (ms: number) =>
  new Date(ms).toISOString().slice(0, 16).replace("T", " ")
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The range in UTC: whole days as days, a range cut mid-day to the minute. */
export function rangeText(start: number, end: number): string {
  if (start === 0) return `until ${utcMinute(end)}`
  if (start % DAY_MS || end % DAY_MS)
    return `from ${utcMinute(start)} to ${utcMinute(end)}`
  const last = utcDay(end - DAY_MS)
  return last === utcDay(start)
    ? `on ${last}`
    : `from ${utcDay(start)} to ${last}`
}

/** Thousands with commas. */
export const fmt = (n: number) => n.toLocaleString("en-US")

/** A share as a percentage: one decimal under 10%. */
export const pct = (part: number) =>
  `${(100 * part).toFixed(part < 0.1 ? 1 : 0)}%`
