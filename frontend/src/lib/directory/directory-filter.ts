/**
 * The Directory filter (DIR-02): which Directory entries the Directory tab
 * lists. It is the shared filter tree (`lib/filter-tree.ts`) over Directory
 * Conditions, and the server evaluates it, as it does the Post filter; the
 * browser never tests an entry.
 *
 * It lives in the workspace URL as `?dirFilter=`, in the shared grammar
 * (`lib/filter-text.ts`): `lang:fa`, `name:"news"` (a bare word too),
 * `is:followed`, `is:followable`, `subscribers >= 1000`, `reach 100..5000`,
 * `reach = none`, `mine:all`, `mine:14d`, with `not`, `and`, `or` and
 * parentheses. DIR-05 to DIR-07 add their Conditions here.
 */

import type { DirectoryFilterGroup, DirectoryMeasureCondition } from "@/client"
import {
  boundKind,
  boundText,
  type MetricBound,
} from "@/lib/channels/channel-metrics"
import {
  ParseError,
  parseTree,
  printTree,
  quote,
  type TextVocabulary,
} from "@/lib/filter-text"
import type { FilterNode, FilterTree } from "@/lib/filter-tree"
import { languageLabel } from "@/lib/posts/post-filter-bar"

export type MeasureKey = DirectoryMeasureCondition["measure"]
export type DirectoryFlag = "followed" | "followable"

export type DirectoryMeasureCond = {
  type: "measure"
  measure: MeasureKey
} & MetricBound

export type DirectoryCond =
  | { type: "language"; value: string }
  | { type: "name"; value: string }
  | { type: "flag"; value: DirectoryFlag }
  /** Cited by "your channels", ever or within the last `days`. */
  | { type: "mine"; days?: number }
  /** Cited by any of these handles, in the view's Reference kinds (DIR-05). */
  | { type: "citedby"; handles: string[] }
  /** Cites any of these handles, in the view's Reference kinds (DIR-05). */
  | { type: "cites"; handles: string[] }
  | DirectoryMeasureCond

export type DirectoryHandlesCond = Extract<
  DirectoryCond,
  { type: "citedby" | "cites" }
>

export type DirectoryFilter = FilterTree<DirectoryCond>

export type MeasureSection = "Size and activity" | "Content" | "References"

export type Measure = {
  key: MeasureKey
  label: string
  /** The column header. */
  short: string
  description: string
  section: MeasureSection
  /** Counted in days: sorts newest first, and the editor offers day presets. */
  days?: true
}

/** In the Filters picker's order. The key is the text form's word. */
export const MEASURES: Measure[] = [
  {
    key: "subscribers",
    label: "Subscribers",
    short: "Subs",
    description: "Subscribers, as Telegram last showed them",
    section: "Size and activity",
  },
  {
    key: "reach",
    label: "Reach",
    short: "Reach",
    description:
      "The median Settled View count of recent Posts; ~ marks an estimate",
    section: "Size and activity",
  },
  {
    key: "posts_per_week",
    label: "Posts per week",
    short: "Posts/wk",
    description: "How often it posts, from its recent Posts",
    section: "Size and activity",
  },
  {
    key: "forward_pct",
    label: "Forwarded posts (%)",
    short: "Fwd %",
    description: "Share of its recent Posts that are forwards",
    section: "Size and activity",
  },
  {
    key: "last_post_days",
    label: "Days since last post",
    short: "Last post",
    description: "How long ago it last posted",
    section: "Size and activity",
    days: true,
  },
  {
    key: "found_days",
    label: "Days since the Directory found it",
    short: "Found",
    description: "How long ago the Directory first saw it",
    section: "Size and activity",
    days: true,
  },
  {
    key: "photos",
    label: "Photos",
    short: "Photos",
    description: "Photos it has posted, as Telegram counts them",
    section: "Content",
  },
  {
    key: "videos",
    label: "Videos",
    short: "Videos",
    description: "Videos it has posted, as Telegram counts them",
    section: "Content",
  },
  {
    key: "files",
    label: "Files",
    short: "Files",
    description: "Files it has posted, as Telegram counts them",
    section: "Content",
  },
  {
    key: "links",
    label: "Links",
    short: "Links",
    description: "Links it has posted, as Telegram counts them",
    section: "Content",
  },
  {
    key: "cited_by",
    label: "Cited by (channels)",
    short: "Cited by",
    description:
      "How many channels cite it, any Reference kind; the Reference kinds pill does not narrow it",
    section: "References",
  },
  {
    key: "cites",
    label: "Cites (channels)",
    short: "Cites",
    description:
      "How many channels it cites, any Reference kind; only Channels somebody follows or the Directory sampled have theirs recorded",
    section: "References",
  },
]

const BY_KEY = new Map(MEASURES.map((m) => [m.key, m]))
export const measureOf = (key: MeasureKey): Measure =>
  BY_KEY.get(key) as Measure

export const FLAG_LABEL: Record<DirectoryFlag, string> = {
  followed: "Followed",
  followable: "Followable",
}

export const HANDLES_LABEL: Record<DirectoryHandlesCond["type"], string> = {
  citedby: "Cited by",
  cites: "Cites",
}

/** Typed handles as the server keys them: no "@", lowercase, each once. */
export const parseHandles = (text: string): string[] => [
  ...new Set(
    text
      .split(/[\s,]+/)
      .map((h) => h.replace(/^@/, "").toLowerCase())
      .filter(Boolean),
  ),
]

/** The tab's first view: what an Account does not follow and can follow. */
export const OPENING_FILTER = "not is:followed and is:followable"

// ---- Labels ----------------------------------------------------------------

/** A chip's label: "Persian", "Followed", "Subscribers ≥ 1K". */
export function directoryConditionLabel(
  cond: DirectoryCond,
  locale?: string,
): string {
  switch (cond.type) {
    case "language":
      return languageLabel(cond.value, locale)
    case "name":
      return `Name contains "${cond.value}"`
    case "flag":
      return FLAG_LABEL[cond.value]
    case "mine":
      return cond.days
        ? `Cited by your channels, last ${cond.days} days`
        : "Cited by your channels"
    case "citedby":
    case "cites":
      return `${HANDLES_LABEL[cond.type]} ${cond.handles.map((h) => `@${h}`).join(", ")}`
    case "measure":
      return `${measureOf(cond.measure).label}${cond.none ? ":" : ""} ${boundText(cond)}`
  }
}

// ---- The text form ---------------------------------------------------------

function condText(cond: DirectoryCond): string {
  switch (cond.type) {
    case "language":
      return `lang:${quote(cond.value)}`
    case "name":
      return `name:${quote(cond.value)}`
    case "flag":
      return `is:${cond.value}`
    case "mine":
      return `mine:${cond.days ? `${cond.days}d` : "all"}`
    case "citedby":
    case "cites":
      return `${cond.type}:${quote(cond.handles.join(" "))}`
    case "measure": {
      const m = cond.measure
      return {
        none: `${m} = none`,
        between: `${m} ${cond.min}..${cond.max}`,
        gte: `${m} >= ${cond.min}`,
        lte: `${m} <= ${cond.max}`,
      }[boundKind(cond)]
    }
  }
}

export const printDirectoryFilter = (filter: DirectoryFilter): string =>
  printTree(filter, condText)

const NUM = String.raw`(\d+(?:\.\d+)?(?:e[+-]?\d+)?)`
const BOUND = new RegExp(
  String.raw`^([a-z_]+)(?:\s*(>=|<=|>|<)\s*${NUM}|\s*=\s*none(?![\p{L}\p{N}_])|\s+${NUM}\s*\.\.\s*${NUM})`,
  "iu",
)

function boundCond(m: RegExpExecArray): DirectoryMeasureCond | null {
  const measure = m[1].toLowerCase() as MeasureKey
  if (!BY_KEY.has(measure)) return null
  if (m[4] !== undefined) {
    const [min, max] = [Number(m[4]), Number(m[5])]
    if (max < min) throw new ParseError(`${measure} ${min}..${max}`)
    return { type: "measure", measure, min, max }
  }
  if (m[2] === undefined) return { type: "measure", measure, none: true }
  // Inclusive, as on Channels and Posts: ">" reads as ">=" and "<" as "<=".
  return m[2].startsWith(">")
    ? { type: "measure", measure, min: Number(m[3]) }
    : { type: "measure", measure, max: Number(m[3]) }
}

const FLAGS = new Set<string>(Object.keys(FLAG_LABEL))
const WINDOW = /^(\d+)d$/

const DIRECTORY_TEXT: TextVocabulary<DirectoryCond> = {
  bound: (rest) => {
    const m = BOUND.exec(rest)
    const cond = m && boundCond(m)
    return m && cond ? { cond, length: m[0].length } : null
  },
  word: (prefix, text) => {
    // A bare word reads as Name contains, so typing "news" does something.
    if (prefix === "name" || prefix === undefined)
      return { type: "name", value: text }
    if (prefix === "lang") return { type: "language", value: text }
    if (prefix === "is" && FLAGS.has(text))
      return { type: "flag", value: text as DirectoryFlag }
    if (prefix === "mine") {
      if (text === "all") return { type: "mine" }
      const days = Number(WINDOW.exec(text)?.[1])
      if (days >= 1) return { type: "mine", days }
    }
    if (prefix === "citedby" || prefix === "cites") {
      const handles = parseHandles(text)
      if (handles.length)
        return prefix === "cites"
          ? { type: "cites", handles }
          : { type: "citedby", handles }
    }
    // An unknown value would be a 422 from the server, so it does not parse.
    throw new ParseError(`Unknown ${prefix}:${text}`)
  },
}

/**
 * What the Directory reads accept (`app/schemas/directory.py`); past these
 * every read is a 422, so a filter outside them is never sent.
 */
export const DIRECTORY_FILTER_BOUNDS = {
  depth: 6,
  nodes: 100,
  languageLength: 16,
  nameLength: 256,
  maxDays: 36_500,
  handles: 50,
  handleLength: 256,
} as const

/** Whether the server accepts `filter`: depth, node count and values. */
export function withinDirectoryFilterBounds(filter: DirectoryFilter): boolean {
  const b = DIRECTORY_FILTER_BOUNDS
  let nodes = 0
  const fits = (node: FilterNode<DirectoryCond>, depth: number): boolean => {
    nodes += 1
    if (depth > b.depth) return false
    if (node.kind === "group")
      return node.children.every((child) => fits(child, depth + 1))
    const { cond } = node
    if (cond.type === "language") return cond.value.length <= b.languageLength
    if (cond.type === "name") return cond.value.length <= b.nameLength
    if (cond.type === "mine") return (cond.days ?? 0) <= b.maxDays
    if (cond.type === "citedby" || cond.type === "cites")
      return (
        cond.handles.length <= b.handles &&
        cond.handles.every((h) => h.length <= b.handleLength)
      )
    return true
  }
  return fits(filter, 1) && nodes <= b.nodes
}

/**
 * The text form back as a filter. Anything that does not parse, or that the
 * server would refuse, is `null`, so a crafted link is ignored rather than
 * failing every read.
 */
export function parseDirectoryFilter(src: string): DirectoryFilter | null {
  const filter = parseTree(src, DIRECTORY_TEXT)
  return filter && withinDirectoryFilterBounds(filter) ? filter : null
}

/** The tree as the Directory reads take it, or `null` for an empty one. */
export const directoryFilterBody = (
  filter: DirectoryFilter,
): DirectoryFilterGroup | null =>
  filter.children.length === 0 ? null : (filter as DirectoryFilterGroup)
