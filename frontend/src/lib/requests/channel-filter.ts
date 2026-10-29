/**
 * The Channel table's filter (RQS-04): a filter tree, as on the Channels tab,
 * over kinds of work, the aggregate rows and every measure, whole-row or per
 * kind. No React, so every rule is pinned by `channel-filter.test.ts`.
 */
import {
  boundText,
  inBound,
  type MetricBound,
} from "@/lib/channels/channel-metrics"
import {
  addFunnel,
  appendAnd,
  emptyTree,
  evalTree,
  type FilterTree,
  funnelledValues,
  removeFunnel,
} from "@/lib/filter-tree"
import {
  type ChannelRow,
  kindMeta,
  MEASURES,
  type Measure,
  measureOf,
  type Outcome,
} from "./breakdown"

export type ChannelCond =
  | { type: "kind"; value: string }
  /** An aggregate row: work with no Channel, which no Account pays for. */
  | { type: "uncharged" }
  /** A number on the whole row, or with `kind` on that kind of work alone. */
  | { type: "measure"; measure: Measure; kind?: string; bound: MetricBound }
  /** A Channel in the reader's Tag of this name (TGU-03). */
  | { type: "tag"; value: string }
export type ChannelFilter = FilterTree<ChannelCond>
export type MeasureCond = Extract<ChannelCond, { type: "measure" }>

export const emptyChannelFilter = () => emptyTree<ChannelCond>()
export const isUncharged = (c: ChannelCond) => c.type === "uncharged"
export const addCond = (f: ChannelFilter, c: ChannelCond) => appendAnd(f, c)

/** A kind's funnel, on or off: what a click in By kind of work does. */
export const pickKind = (f: ChannelFilter, kind: string) =>
  funnelledValues(f, "kind").includes(kind)
    ? removeFunnel(f, "kind", kind)
    : addFunnel(f, { type: "kind", value: kind })

export const measureMeta = (m: Measure) =>
  MEASURES.find((x) => x.id === m) ?? MEASURES[0]

/** Only a sync has syncs and Posts; the other work is Requests alone. */
const SYNC_KINDS = new Set(["auto", "bulk", "single"])
const REQUEST_MEASURES: Measure[] = [
  "total",
  "idle",
  "wasted",
  "idleShare",
  "wasteShare",
]
const kindMeasures = (kind?: string): Measure[] =>
  kind === undefined || SYNC_KINDS.has(kind)
    ? MEASURES.map((m) => m.id)
    : REQUEST_MEASURES

export const measureLabel = (m: Measure, kind?: string) =>
  kind
    ? `${kindMeta(kind).label} · ${measureMeta(m).label}`
    : measureMeta(m).label

const outcomeHidden = (m: Measure, hidden: ReadonlySet<Outcome>) => {
  const outcome = measureMeta(m).outcome
  return outcome !== undefined && hidden.has(outcome)
}

export interface CriteriaGroup {
  heading: string
  kind?: string
  measures: Measure[]
}

/** Every number the Filters menu offers: the whole row's, then each shown kind's. */
export function criteria(
  shownKinds: readonly string[],
  hiddenOutcomes: ReadonlySet<Outcome>,
): CriteriaGroup[] {
  return [undefined, ...shownKinds].map((kind) => ({
    heading: kind ? kindMeta(kind).label : "Whole row",
    kind,
    measures: kindMeasures(kind).filter(
      (m) => !outcomeHidden(m, hiddenOutcomes),
    ),
  }))
}

/**
 * The rows the filter keeps. A Condition on a hidden kind or a hidden
 * outcome stands aside rather than failing, so unticking one above never
 * empties the table.
 */
export const keepRow =
  (
    filter: ChannelFilter,
    hiddenKinds: ReadonlySet<string>,
    hiddenOutcomes: ReadonlySet<Outcome>,
    /** A Tag's handles, lowercased; undefined while they load, which stands aside. */
    tagHandles: (tag: string) => ReadonlySet<string> | undefined = () =>
      undefined,
  ) =>
  (r: ChannelRow) =>
    evalTree(filter, (c) => {
      if (c.type === "kind") return r.kinds.has(c.value)
      if (c.type === "uncharged") return r.aggregate
      if (c.type === "tag") {
        const handles = tagHandles(c.value)
        return handles === undefined || handles.has(r.key.toLowerCase())
      }
      return (
        outcomeHidden(c.measure, hiddenOutcomes) ||
        (c.kind !== undefined && hiddenKinds.has(c.kind)) ||
        inBound(measureOf(r, c.measure, c.kind), c.bound)
      )
    })

/** A Condition's chip. */
export const condLabel = (c: ChannelCond) =>
  c.type === "tag"
    ? `Tag ${c.value}`
    : c.type === "kind"
    ? kindMeta(c.value).label
    : c.type === "uncharged"
      ? "Uncharged rows"
      : `${measureLabel(c.measure, c.kind)} ${boundText(c.bound)}${measureMeta(c.measure).unit ?? ""}`

/** Why a Condition stands aside, for its chip; undefined while it applies. */
export function staleReason(
  c: ChannelCond,
  hiddenKinds: ReadonlySet<string>,
  hiddenOutcomes: ReadonlySet<Outcome>,
): string | undefined {
  const kind = c.type === "kind" ? c.value : c.type === "measure" ? c.kind : ""
  if (kind && hiddenKinds.has(kind))
    return `${kindMeta(kind).label} is unticked above, so this stands aside`
  if (c.type === "measure" && outcomeHidden(c.measure, hiddenOutcomes))
    return `${measureMeta(c.measure).label} is hidden above, so this stands aside`
  return undefined
}
