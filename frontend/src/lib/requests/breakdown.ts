/**
 * What the Requests tab makes of the Breakdown (RQS-03, ADR-035): the kind
 * table, the Channel table, the totals and the range. No React, so every rule
 * is pinned by `breakdown.test.ts`.
 */
import type {
  AccountRequestTotals,
  ChannelRequestTotals,
  RequestTotals,
} from "@/client"
import { floorToMinute } from "@/lib/analysis-window"
import { emptyTree } from "@/lib/filter-tree"
import { DAY_MS } from "@/lib/scope/window"
import { resolveTimeBound, type TimeBound } from "@/lib/time-bound/bound"
import type { ChannelFilter } from "./channel-filter"

export type Outcome = "useful" | "idle" | "wasted"
export type ChargedFilter = "all" | "charged" | "uncharged"

export const OUTCOMES: { id: Outcome; label: string }[] = [
  { id: "useful", label: "Useful" },
  { id: "idle", label: "Idle" },
  { id: "wasted", label: "Wasted" },
]

/**
 * What every part of the tab reads (spec, "Tab-wide state"). One value, so
 * the trend and the tables hide the same kinds and outcomes and leave out
 * the same Channels.
 */
export interface RequestsFilter {
  bound: TimeBound
  charged: ChargedFilter
  /** Picked Accounts' ids: their charged Requests alone (RQS-05). */
  accounts: readonly string[]
  hiddenKinds: ReadonlySet<string>
  hiddenOutcomes: ReadonlySet<Outcome>
  /** The Channel table's rows left out, by `ChannelRow.id` (RQS-04). */
  leftOut: ReadonlySet<string>
  /** What the Channel table lists; By kind of work adds kinds to it. */
  channelFilter: ChannelFilter
}

/**
 * A change to the filter: the fields to set, or a function of the filter as
 * it is by then, for a change that builds on one just made (RQS-08).
 */
export type FilterUpdate =
  | Partial<RequestsFilter>
  | ((f: RequestsFilter) => Partial<RequestsFilter>)

export const updated = (
  f: RequestsFilter,
  u: FilterUpdate,
): RequestsFilter => ({
  ...f,
  ...(typeof u === "function" ? u(f) : u),
})

export const initialRequestsFilter = (): RequestsFilter => ({
  bound: { mode: "live", start: -30 * DAY_MS },
  charged: "all",
  accounts: [],
  hiddenKinds: new Set(),
  hiddenOutcomes: new Set(),
  leftOut: new Set(),
  channelFilter: emptyTree(),
})

const AGGREGATE_ID = "kind:"

/**
 * A Channel's row by its handle; a row of work with no Channel by its kind.
 * A Telegram handle never holds a colon, so the two never meet.
 */
const rowId = (channel: string | null, kind: string) =>
  channel ?? `${AGGREGATE_ID}${kind}`

/** The rows left out as the API takes them: handles, and aggregate rows' kinds. */
export function leftOutQuery(leftOut: ReadonlySet<string>) {
  const ids = [...leftOut].sort()
  return {
    leftOut: ids.filter((id) => !id.startsWith(AGGREGATE_ID)),
    leftOutKinds: ids
      .filter((id) => id.startsWith(AGGREGATE_ID))
      .map((id) => id.slice(AGGREGATE_ID.length)),
  }
}

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

/** A row's Requests by outcome, and what its syncs did (RQS-04). */
export interface KindTally extends Tally {
  syncs: number
  failed: number
  /** New Posts its pages brought. */
  posts: number
}

const emptyKindTally = (): KindTally => ({
  ...emptyTally(),
  syncs: 0,
  failed: 0,
  posts: 0,
})

export interface ChannelRow extends KindTally {
  /** What picking it leaves out; see `leftOutQuery`. */
  id: string
  /** The handle, or the aggregate row's kind. */
  key: string
  /** What the table shows and the search reads: `@handle`, or a row name. */
  label: string
  /** The name sorting by Channel uses: the handle without its `@`. */
  name: string
  aggregate: boolean
  /** The kind that spent most on this row, for its swatch. */
  mainKind: string
  /** The kinds of work with shown Requests on this row. */
  kinds: ReadonlySet<string>
  /** The same numbers for each kind of work on this row. */
  perKind: ReadonlyMap<string, KindTally>
}

/**
 * Adds one kind's part to its row, or to that kind on the row. A hidden
 * outcome's Requests stay out, but every sync and new Post still counts: the
 * sync happened whether or not its Requests show.
 */
function addPart(
  row: KindTally,
  part: ChannelRequestTotals,
  hidden: ReadonlySet<Outcome>,
) {
  addTo(row, { ...part, total: part.requests }, hidden)
  row.syncs += part.syncs
  row.failed += part.failedSyncs
  row.posts += part.newPosts
}

/** One row per Channel, the work with no Channel as a row per kind. */
export function channelRows(
  byChannel: readonly ChannelRequestTotals[],
  hiddenKinds: ReadonlySet<string>,
  hiddenOutcomes: ReadonlySet<Outcome>,
): ChannelRow[] {
  const rows = new Map<string, NewRow>()
  for (const part of byChannel) {
    if (hiddenKinds.has(part.kind)) continue
    const id = rowId(part.channel, part.kind)
    const row = rows.get(id) ?? newChannelRow(id, part)
    const kind = row.perKind.get(part.kind) ?? emptyKindTally()
    addPart(row, part, hiddenOutcomes)
    addPart(kind, part, hiddenOutcomes)
    row.perKind.set(part.kind, kind)
    rows.set(id, row)
  }
  return [...rows.values()]
    .filter((r) => r.total > 0)
    .map((row) => {
      const busiest = [...row.perKind].sort((a, b) => b[1].total - a[1].total)
      return {
        ...row,
        mainKind: busiest[0][0],
        kinds: new Set(busiest.filter(([, t]) => t.total > 0).map(([k]) => k)),
      }
    })
    .sort((a, b) => b.total - a.total)
}

type NewRow = ChannelRow & { perKind: Map<string, KindTally> }

function newChannelRow(id: string, part: ChannelRequestTotals): NewRow {
  const aggregate = part.channel === null
  const name =
    part.channel ??
    AGGREGATE_LABEL[part.kind] ??
    `${kindMeta(part.kind).label}, no Channel`
  return {
    ...emptyKindTally(),
    id,
    key: part.channel ?? part.kind,
    name,
    label: aggregate ? name : `@${name}`,
    aggregate,
    mainKind: part.kind,
    kinds: new Set(),
    perKind: new Map(),
  }
}

/** Rows the Requests tab's Channel table shows first. */
export const FIRST_CHANNELS = 25
/** Rows each "Show more" adds to the Requests tab's Channel table. */
export const MORE_CHANNELS = 50

/** Every number a Channel row has: its columns, sorts and filters (RQS-04). */
export type Measure =
  | "total"
  | "idle"
  | "wasted"
  | "idleShare"
  | "wasteShare"
  | "syncs"
  | "failed"
  | "posts"
  | "perSync"
  | "postsPerReq"
export type ChannelSort = Measure | "channel"
export type SortDirection = "asc" | "desc"

/** `outcome` names the outcome a measure is about: hiding it hides the measure. */
export const MEASURES: {
  id: Measure
  label: string
  unit?: string
  outcome?: Outcome
}[] = [
  { id: "total", label: "Requests" },
  { id: "idle", label: "Idle Requests", outcome: "idle" },
  { id: "wasted", label: "Wasted Requests", outcome: "wasted" },
  { id: "idleShare", label: "Idle share", unit: "%", outcome: "idle" },
  { id: "wasteShare", label: "Wasted share", unit: "%", outcome: "wasted" },
  { id: "syncs", label: "Syncs" },
  { id: "failed", label: "Failed syncs" },
  { id: "posts", label: "New Posts" },
  { id: "perSync", label: "Requests per sync" },
  { id: "postsPerReq", label: "New Posts per Request" },
]

/** The Channel table's number columns; `outcome` names the one it is about. */
const CHANNEL_COLUMNS: {
  key: Measure
  label: string
  outcome?: Outcome
}[] = [
  { key: "total", label: "Requests" },
  { key: "idle", label: "Idle", outcome: "idle" },
  { key: "wasted", label: "Wasted", outcome: "wasted" },
  { key: "idleShare", label: "Idle %", outcome: "idle" },
  { key: "wasteShare", label: "Wasted %", outcome: "wasted" },
  { key: "postsPerReq", label: "New Posts / Req" },
]

/** The columns left once a hidden outcome takes its own away. */
export const channelColumns = (hidden: ReadonlySet<Outcome>) =>
  CHANNEL_COLUMNS.filter((c) => !c.outcome || !hidden.has(c.outcome))

const PER: Partial<Record<Measure, (t: KindTally) => number | null>> = {
  idleShare: (t) => (t.total ? (100 * t.idle) / t.total : 0),
  wasteShare: (t) => (t.total ? (100 * t.wasted) / t.total : 0),
  perSync: (t) => (t.syncs ? t.total / t.syncs : null),
  // What a Request yields: 20 is a full page of new Posts, 0 nothing new.
  postsPerReq: (t) => (t.total ? t.posts / t.total : null),
}

/**
 * A row's number, whole or for one `kind` of its work, as a filter bounds it
 * (shares in percent). Null when the row has none of that work, and the
 * aggregate rows have no New Posts per Request: they fetch no Posts.
 */
export function measureOf(
  r: ChannelRow,
  m: Measure,
  kind?: string,
): number | null {
  const t = kind ? r.perKind.get(kind) : r
  if (!t || (t.total === 0 && t.syncs === 0)) return null
  if (m === "postsPerReq" && r.aggregate) return null
  const per = PER[m]
  return per
    ? per(t)
    : t[m as "total" | "idle" | "wasted" | "syncs" | "failed" | "posts"]
}

/** Two rows by one measure; a row without it goes last either way. */
function byMeasure(a: ChannelRow, b: ChannelRow, m: Measure, sign: number) {
  const [x, y] = [measureOf(a, m), measureOf(b, m)]
  if (x === null || y === null) return Number(x === null) - Number(y === null)
  return sign * (x - y)
}

/** The rows a search and `keep` leave, in the order picked. */
export function listChannels(
  rows: readonly ChannelRow[],
  search: string,
  sort: ChannelSort,
  direction: SortDirection,
  keep: (r: ChannelRow) => boolean = () => true,
): ChannelRow[] {
  const words = search.trim().toLowerCase().replace(/^@/, "")
  const sign = direction === "desc" ? -1 : 1
  return rows
    .filter((r) => r.name.toLowerCase().includes(words) && keep(r))
    .sort((a, b) =>
      sort === "channel"
        ? sign * a.name.localeCompare(b.name)
        : byMeasure(a, b, sort, sign),
    )
}

export interface AccountRow extends Tally {
  id: string
  /** Blank for an Account deleted since. */
  email: string
  /** The shown Requests of each kind this Account paid for. */
  byKind: Record<string, number>
}

/** Each Account's charged Requests, busiest first (RQS-05). */
export function accountRows(
  byAccount: readonly AccountRequestTotals[],
  hiddenKinds: ReadonlySet<string>,
  hiddenOutcomes: ReadonlySet<Outcome>,
): AccountRow[] {
  const rows = new Map<string, AccountRow>()
  for (const part of byAccount) {
    const row = rows.get(part.accountId) ?? {
      ...emptyTally(),
      id: part.accountId,
      email: part.email,
      byKind: {},
    }
    const tally = hiddenKinds.has(part.kind)
      ? emptyTally()
      : tallyOf(part, hiddenOutcomes)
    addTo(row, tally, new Set())
    row.byKind[part.kind] = (row.byKind[part.kind] ?? 0) + tally.total
    rows.set(part.accountId, row)
  }
  return [...rows.values()].sort((a, b) => b.total - a.total)
}

/**
 * The comparison's kind columns: only charged work is an Account's. Picking
 * Accounts hides every Uncharged Request, so Bot API, violet like the
 * Account ramp, never sits beside an Account.
 */
export const COMPARE_KINDS = KINDS.filter((k) => k.charged)

/** Steps on the violet Account ramp, `--account-1` to `--account-4`. */
const ACCOUNT_STEPS = 4

/** An Account's ramp step, by its place among every Account, so picking never repaints it. */
export const accountColor = (id: string, every: readonly string[]) =>
  `var(--account-${(Math.max(0, every.indexOf(id)) % ACCOUNT_STEPS) + 1})`

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
