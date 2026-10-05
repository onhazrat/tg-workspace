// PROTOTYPE (find-prototype): the Directory filter as the shared AND/OR/NOT
// tree (lib/filter-tree.ts), its Conditions, chip labels and the text form,
// for the bar variants T, Q and R. The server evaluates the tree
// (proto_find_api.py::_tree_sql); nothing here tests a row.

import { ParseError, parseTree, printTree, quote } from "@/lib/filter-text"
import {
  type AtomNode,
  atoms,
  emptyTree,
  type FilterTree,
  mapGroups,
  newId,
} from "@/lib/filter-tree"
import {
  type Bound,
  fmtValue,
  METRICS,
  type Mode,
  metricOf,
} from "./VariantBrowseTop"

// "photo" is left out: every Channel in the Directory has a photo URL.
export type Flag = "followed" | "dismissed" | "available"
export type PickSource = "selection" | "follows" | "handles"

export type DCond =
  | { type: "language"; value: string }
  | { type: "flag"; value: Flag }
  | { type: "name"; value: string }
  | {
      type: "metric"
      metric: string
      mode: Mode
      min: number | null
      max: number | null
    }
  | { type: "cited_by" | "cites"; handles: string[] }
  /** Cited by your channels at all, or within the last `days`. */
  | { type: "mine"; days: number | null }
  | {
      type: "parents" | "children"
      source: PickSource
      handles: string[]
      min: number
    }

export type DTree = FilterTree<DCond>

export const FLAG_LABEL: Record<Flag, string> = {
  followed: "Followed",
  dismissed: "Not interested",
  available: "Available",
}

const handlesText = (hs: string[]) => hs.map((h) => `@${h}`).join(" or ")

export function condLabel(c: DCond, langName: (code: string) => string) {
  switch (c.type) {
    case "language":
      return langName(c.value)
    case "flag":
      return FLAG_LABEL[c.value]
    case "name":
      return `name has "${c.value}"`
    case "metric":
      return metricLabel(c)
    case "cited_by":
      return `cited by ${handlesText(c.handles)}`
    case "cites":
      return `cites ${handlesText(c.handles)}`
    case "mine":
      return c.days
        ? `your channels cited it, last ${c.days}d`
        : "your channels cite it"
    case "parents":
    case "children":
      return `${c.min}+ shared ${c.type} with ${c.source === "handles" ? handlesText(c.handles) : `your ${c.source}`}`
  }
}

function metricLabel(c: DCond & { type: "metric" }) {
  const m = metricOf(c.metric)
  const body =
    c.mode === "none"
      ? "no value"
      : c.mode === "atLeast"
        ? `≥ ${fmtValue(m, c.min)}`
        : c.mode === "atMost"
          ? `≤ ${fmtValue(m, c.max)}`
          : `${fmtValue(m, c.min)}–${fmtValue(m, c.max)}`
  return `${m.label} ${body}`
}

export const boundOf = (c: DCond & { type: "metric" }): Bound => ({
  metric: c.metric,
  mode: c.mode,
  min: c.min,
  max: c.max,
  negate: false,
})
export const metricCond = (b: Bound): DCond => ({
  type: "metric",
  metric: b.metric,
  mode: b.mode,
  min: b.min,
  max: b.max,
})

// ---- the text form -----------------------------------------------------------
// `lang:fa`, `is:followed`, `name:"news"`, `subscribers >= 1000`,
// `reach 100..5000`, `reach = none`, `citedby:durov`, `cites:"a b"`,
// `mine:14d`, `mine:all`, `parents:selection`, `children:"a b 3"` (a trailing
// number is the minimum), and `not`, `and`, `or`, parentheses.

const condText = (c: DCond): string => {
  switch (c.type) {
    case "language":
      return `lang:${quote(c.value)}`
    case "flag":
      return `is:${c.value}`
    case "name":
      return `name:${quote(c.value)}`
    case "metric":
      return c.mode === "none"
        ? `${c.metric} = none`
        : c.mode === "between"
          ? `${c.metric} ${c.min}..${c.max}`
          : c.mode === "atLeast"
            ? `${c.metric} >= ${c.min}`
            : `${c.metric} <= ${c.max}`
    case "cited_by":
      return `citedby:${quote(c.handles.join(" "))}`
    case "cites":
      return `cites:${quote(c.handles.join(" "))}`
    case "mine":
      return `mine:${c.days ? `${c.days}d` : "all"}`
    case "parents":
    case "children": {
      const who = c.source === "handles" ? c.handles.join(" ") : c.source
      return `${c.type}:${quote(c.min === 2 ? who : `${who} ${c.min}`)}`
    }
  }
}

export const printDirectory = (t: DTree) => printTree(t, condText)

const NUM = String.raw`(-?\d+(?:\.\d+)?)`
const METRIC_RE = new RegExp(
  String.raw`^([a-z_]+)(?:\s*(>=|<=|>|<)\s*${NUM}|\s*=\s*none(?![\p{L}\p{N}_])|\s+${NUM}\s*\.\.\s*${NUM})`,
  "iu",
)
export const METRIC_KEYS = new Set(METRICS.map((m) => m.key))
const FLAGS = new Set(Object.keys(FLAG_LABEL))
const splitHandles = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((h) => h.replace(/^@/, "").toLowerCase())
    .filter(Boolean)

function word(prefix: string | undefined, text: string): DCond {
  switch (prefix) {
    case "lang":
      return { type: "language", value: text }
    case "is":
      if (!FLAGS.has(text)) throw new ParseError(`Unknown is:${text}`)
      return { type: "flag", value: text as Flag }
    case "name":
    case undefined:
      // A bare word reads as a name filter, so typing "news" does something.
      return { type: "name", value: text }
    case "citedby":
    case "cites":
      return {
        type: prefix === "citedby" ? "cited_by" : "cites",
        handles: splitHandles(text),
      }
    case "mine": {
      const days = Number.parseInt(text, 10)
      return { type: "mine", days: Number.isFinite(days) ? days : null }
    }
    case "parents":
    case "children": {
      const parts = splitHandles(text)
      const last = Number(parts.at(-1))
      const min = parts.length > 1 && Number.isInteger(last) ? last : 2
      const who = min === last && parts.length > 1 ? parts.slice(0, -1) : parts
      const source: PickSource =
        who[0] === "selection" || who[0] === "follows" ? who[0] : "handles"
      return {
        type: prefix,
        source,
        handles: source === "handles" ? who : [],
        min,
      }
    }
  }
  throw new ParseError(`Unknown ${prefix}:`)
}

export function parseDirectory(src: string): DTree | null {
  return parseTree<DCond>(src, {
    bound: (rest) => {
      const m = METRIC_RE.exec(rest)
      if (!m || !METRIC_KEYS.has(m[1].toLowerCase())) return null
      const metric = m[1].toLowerCase()
      const cond: DCond =
        m[4] !== undefined
          ? {
              type: "metric",
              metric,
              mode: "between",
              min: Number(m[4]),
              max: Number(m[5]),
            }
          : m[2] === undefined
            ? { type: "metric", metric, mode: "none", min: null, max: null }
            : m[2].startsWith(">")
              ? {
                  type: "metric",
                  metric,
                  mode: "atLeast",
                  min: Number(m[3]),
                  max: null,
                }
              : {
                  type: "metric",
                  metric,
                  mode: "atMost",
                  min: null,
                  max: Number(m[3]),
                }
      return { cond, length: m[0].length }
    },
    word,
  })
}

/** The spec's opening view: not followed, not dismissed, available. */
export const OPENING = "not is:followed and not is:dismissed and is:available"

// ---- editing helpers the bars share ------------------------------------------

/** The filter as a plain AND root, wrapping it when it is an OR or negated. */
export function andRoot(t: DTree): DTree {
  if (!t.children.length) return { ...emptyTree<DCond>(), not: false }
  if (!t.not && (t.op === "and" || t.children.length === 1))
    return { ...t, op: "and" }
  return { ...emptyTree<DCond>(), children: [{ ...t, id: newId() }] }
}

const rootAtoms = (t: DTree) =>
  t.children.filter((c): c is AtomNode<DCond> => c.kind === "atom")

/** A flag on the root: "yes" (it), "no" (not it), or null when absent. */
export function rootFlag(t: DTree, flag: Flag): "yes" | "no" | null {
  if (t.op === "or" && t.children.length > 1) return null
  const a = rootAtoms(t).find(
    (n) => n.cond.type === "flag" && n.cond.value === flag,
  )
  return a ? (a.not ? "no" : "yes") : null
}

/** Remove the root's atoms `drop` matches, then append `add` if any. */
export function setRoot(
  t: DTree,
  drop: (c: DCond) => boolean,
  add?: { cond: DCond; not?: boolean },
): DTree {
  const base = andRoot(t)
  const kept = base.children.filter((c) => c.kind !== "atom" || !drop(c.cond))
  return {
    ...base,
    children: add
      ? [...kept, { kind: "atom", id: newId(), cond: add.cond, not: add.not }]
      : kept,
  }
}

export const setRootFlag = (t: DTree, flag: Flag, state: "yes" | "no" | null) =>
  setRoot(
    t,
    (c) => c.type === "flag" && c.value === flag,
    state
      ? { cond: { type: "flag", value: flag }, not: state === "no" }
      : undefined,
  )

/** A metric's bound on the root, the one the rail's slider edits. */
export const rootMetric = (t: DTree, metric: string) =>
  rootAtoms(t).find(
    (n) => n.cond.type === "metric" && n.cond.metric === metric && !n.not,
  )?.cond as (DCond & { type: "metric" }) | undefined

/** The tree with every Condition `drop` matches removed, wherever it is. */
export function without(t: DTree, drop: (c: DCond) => boolean): DTree {
  return mapGroups(t, (g) => ({
    ...g,
    children: g.children.filter((c) => c.kind !== "atom" || !drop(c.cond)),
  }))
}

export const condsOf = (t: DTree) => atoms(t).map((a) => a.cond)
