/**
 * The Post filter (PTR-03): which Posts the Posts tab shows. It is the
 * Channel filter's tree (`lib/filter-tree.ts`) over Post Conditions, so
 * "(Persian and video) or (views >= 10K)" and "not forwarded" are both one
 * filter. It decides only what the tab shows; it never enters the Scope
 * (ADR-026). The server evaluates it, so the browser never tests a Post.
 *
 * It lives in the workspace URL as `?postFilter=`, the text form below.
 */

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
import {
  addFunnel,
  emptyTree,
  type FilterNode,
  type FilterTree,
} from "@/lib/filter-tree"
import type { ViewMeasure } from "@/lib/posts/estimated-views"
import {
  labelOf,
  languageLabel,
  VIEW_MEASURE_OPTIONS,
} from "@/lib/posts/post-filter-bar"
import { MEDIA_KIND_OPTIONS, type MediaKind } from "@/lib/posts/post-media"

export type PostType = "forwarded" | "original" | "unfollowed_forwarded"

export type PostValueCond =
  | { type: "type"; value: PostType }
  | { type: "media"; value: MediaKind }
  | { type: "language"; value: string }
  | { type: "channel"; value: string }
/** A bound on one measure; `none` passes only a Post with no value for it. */
export type PostViewsCond = {
  type: "views"
  measure: ViewMeasure
} & MetricBound
export type PostCond = PostValueCond | PostViewsCond
export type PostFilter = FilterTree<PostCond>
/** The Conditions a dropdown funnels. */
export type PostFacet = "type" | "media" | "language"

export const emptyPostFilter = (): PostFilter => emptyTree<PostCond>()

/** The Type dropdown's rows, in its order. */
export const POST_TYPE_VALUES: { label: string; value: PostType }[] = [
  { label: "Original", value: "original" },
  { label: "Forwarded", value: "forwarded" },
  {
    label: "Forwarded from unfollowed channels",
    value: "unfollowed_forwarded",
  },
]

/**
 * A dropdown funnel: two in one dropdown join with OR, different dropdowns
 * with AND (`filter-tree.ts::addFunnel`).
 */
export const addPostFunnel = (
  filter: PostFilter,
  type: PostFacet,
  value: string,
): PostFilter => addFunnel(filter, { type, value } as PostValueCond)

export const isEmptyPostFilter = (filter: PostFilter): boolean =>
  filter.children.length === 0

// ---- Labels ----------------------------------------------------------------

export const measureLabel = (measure: ViewMeasure): string =>
  labelOf(VIEW_MEASURE_OPTIONS, measure)

/** A chip's label: "Persian", "Photo", "Forwarded", "@channel", "Views ≥ 10K". */
export function postConditionLabel(cond: PostCond): string {
  switch (cond.type) {
    case "type":
      return labelOf(POST_TYPE_VALUES, cond.value)
    case "media":
      return labelOf(MEDIA_KIND_OPTIONS, cond.value)
    case "language":
      return languageLabel(cond.value)
    case "channel":
      return `@${cond.value}`
    case "views":
      return `${measureLabel(cond.measure)}${cond.none ? ":" : ""} ${boundText(cond)}`
  }
}

// ---- The URL form ----------------------------------------------------------

const PREFIX: Record<PostValueCond["type"], string> = {
  type: "type",
  media: "media",
  language: "lang",
  channel: "channel",
}

function condText(cond: PostCond): string {
  if (cond.type !== "views") return `${PREFIX[cond.type]}:${quote(cond.value)}`
  const m = cond.measure
  return {
    none: `${m} = none`,
    between: `${m} ${cond.min}..${cond.max}`,
    gte: `${m} >= ${cond.min}`,
    lte: `${m} <= ${cond.max}`,
  }[boundKind(cond)]
}

/**
 * The readable text form: `type:forwarded`, `media:photo`, `lang:fa`,
 * `channel:name`, `views >= 1000`, `estimated <= 500`, `views 100..1000`,
 * `views = none`, `not`, `and`, `or` and parentheses.
 */
export const printPostFilter = (filter: PostFilter): string =>
  printTree(filter, condText)

const NUM = String.raw`(\d+(?:\.\d+)?(?:e[+-]?\d+)?)`
/** `views >= 200`, `estimated 200..1000` or `views = none`. */
const BOUND = new RegExp(
  String.raw`^(views|estimated)(?:\s*(>=|<=|>|<)\s*${NUM}|\s*=\s*none(?![\p{L}\p{N}_])|\s+${NUM}\s*\.\.\s*${NUM})`,
  "iu",
)

function boundCond(m: RegExpExecArray): PostViewsCond {
  const measure = m[1].toLowerCase() as ViewMeasure
  if (m[4] !== undefined)
    return { type: "views", measure, min: Number(m[4]), max: Number(m[5]) }
  if (m[2] === undefined) return { type: "views", measure, none: true }
  // Inclusive, as on Channels: ">" reads as ">=" and "<" as "<=".
  return m[2].startsWith(">")
    ? { type: "views", measure, min: Number(m[3]) }
    : { type: "views", measure, max: Number(m[3]) }
}

const TYPES = new Set<string>(POST_TYPE_VALUES.map((t) => t.value))
const MEDIA = new Set<string>(MEDIA_KIND_OPTIONS.map((m) => m.value))

const POST_TEXT: TextVocabulary<PostCond> = {
  bound: (rest) => {
    const m = BOUND.exec(rest)
    return m ? { cond: boundCond(m), length: m[0].length } : null
  },
  word: (prefix, text) => {
    // An unknown value would be a 422 from the server, so it does not parse.
    if (prefix === "type" && TYPES.has(text))
      return { type: "type", value: text as PostType }
    if (prefix === "media" && MEDIA.has(text))
      return { type: "media", value: text as MediaKind }
    if (prefix === "lang") return { type: "language", value: text }
    if (prefix === "channel") return { type: "channel", value: text }
    throw new ParseError(`Unknown ${prefix ?? text}`)
  },
}

/**
 * What the posts reads accept (`app/schemas/posts.py`): past these every read
 * is a 422, so a filter outside them is never sent.
 */
export const POST_FILTER_BOUNDS = {
  depth: 6,
  nodes: 100,
  languageLength: 16,
  channelLength: 256,
} as const

/** Whether the server accepts `filter`: depth, node count and value lengths. */
export function withinPostFilterBounds(filter: PostFilter): boolean {
  let nodes = 0
  const fits = (node: FilterNode<PostCond>, depth: number): boolean => {
    nodes += 1
    if (depth > POST_FILTER_BOUNDS.depth) return false
    if (node.kind === "group")
      return node.children.every((child) => fits(child, depth + 1))
    const { cond } = node
    if (cond.type === "language")
      return cond.value.length <= POST_FILTER_BOUNDS.languageLength
    if (cond.type === "channel")
      return cond.value.length <= POST_FILTER_BOUNDS.channelLength
    return true
  }
  return fits(filter, 1) && nodes <= POST_FILTER_BOUNDS.nodes
}

/**
 * The text form back as a filter. Anything that does not parse, or that the
 * server would refuse, is `null`, so a crafted link is ignored rather than
 * failing every read.
 */
export function parsePostFilter(src: string): PostFilter | null {
  const filter = parseTree(src, POST_TEXT)
  return filter && withinPostFilterBounds(filter) ? filter : null
}

// ---- The wire --------------------------------------------------------------

/**
 * The tree as the posts reads take it, or `undefined` for an empty one. The
 * shape is the tree's own, ids included; the server reads `kind`, `op`, `not`
 * and `cond` and refuses anything else.
 */
export function postFilterBody(
  filter: PostFilter,
): FilterNode<PostCond> | undefined {
  return isEmptyPostFilter(filter) ? undefined : filter
}
