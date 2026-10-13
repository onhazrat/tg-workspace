/**
 * The Post filter (PTR-03): which Posts the Posts tab shows. It is the
 * Channel filter's tree (`lib/filter-tree.ts`) over Post Conditions, so
 * "(Persian and video) or (views >= 10K)" and "not forwarded" are both one
 * filter. It decides only what the tab shows; it never enters the Scope
 * (ADR-026). The server evaluates it, so the browser never tests a Post.
 *
 * It lives in the workspace URL as `?postFilter=`, the text form below.
 */

import { Eye, Hash, type LucideIcon } from "lucide-react"
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
  viewMeasureDescription,
} from "@/lib/posts/post-filter-bar"
import { MEDIA_KIND_OPTIONS, type MediaKind } from "@/lib/posts/post-media"

export type PostType =
  | "forwarded"
  | "original"
  | "unfollowed_forwarded"
  | "is_reply"
  | "has_reply"

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
/**
 * A bound on how many Posts the Post's Channel has in the Analysis window
 * (PTI-02): every one, or only those the rest of the filter keeps. Whole
 * numbers, and never "no value": every Channel with a Post has a count.
 */
export type PostChannelPostsCond = (
  | { type: "channel_posts" }
  | { type: "channel_posts_filtered" }
) & { min?: number; max?: number }
export type PostCond = PostValueCond | PostViewsCond | PostChannelPostsCond
export type PostFilter = FilterTree<PostCond>
export type ChannelPostsNumber = "channel_posts" | "channel_posts_filtered"
/** A number the Filters menu bounds; also the measure its histogram reads. */
export type PostNumber = ViewMeasure | ChannelPostsNumber

/** Everything the editors, the menu and the picker say about one number. */
export type PostNumberRow = {
  label: string
  value: PostNumber
  /** The condition picker's entry id; the views measures keep theirs. */
  entry: string
  icon: LucideIcon
  /** What its histogram's bars count. */
  noun: "posts" | "channels"
  /** A count: whole bounds, rounded inward, and never "no value" (PTI-02). */
  whole: boolean
  /** What it counts, in one line. */
  description: (floorHours: number) => string
}

const viewsNumber = (value: ViewMeasure): PostNumberRow => ({
  label: labelOf(VIEW_MEASURE_OPTIONS, value),
  value,
  entry: `views:${value}`,
  icon: Eye,
  noun: "posts",
  whole: false,
  description: (floorHours) => viewMeasureDescription(value, floorHours),
})

const channelPostsNumber = (
  value: ChannelPostsNumber,
  label: string,
  description: string,
): PostNumberRow => ({
  label,
  value,
  entry: value,
  icon: Hash,
  noun: "channels",
  whole: true,
  description: () => description,
})

export const POST_NUMBER: Record<PostNumber, PostNumberRow> = {
  views: viewsNumber("views"),
  estimated: viewsNumber("estimated"),
  channel_posts: channelPostsNumber(
    "channel_posts",
    "Channel posts in window",
    "How many posts the post's channel has in the window.",
  ),
  channel_posts_filtered: channelPostsNumber(
    "channel_posts_filtered",
    "Channel posts in filtered window",
    "How many of the channel's posts in the window the rest of the filter and the search keep.",
  ),
}

/**
 * The number filters, in the Filters menu's order. The menu and the
 * condition picker both read this list, so neither can offer one the other
 * does not.
 */
export const POST_NUMBERS: PostNumberRow[] = Object.values(POST_NUMBER)

export const isChannelPosts = (type: string): type is ChannelPostsNumber =>
  type === "channel_posts" || type === "channel_posts_filtered"

type PostNumberCond = PostViewsCond | PostChannelPostsCond

const isNumberCond = (cond: PostCond): cond is PostNumberCond =>
  cond.type === "views" || isChannelPosts(cond.type)

const numberOf = (cond: PostNumberCond): PostNumber =>
  cond.type === "views" ? cond.measure : cond.type

/** The number a bound Condition bounds and its bound, or `null` for a value Condition. */
export function postNumberOf(
  cond: PostCond,
): { number: PostNumber; bound: MetricBound } | null {
  return isNumberCond(cond) ? { number: numberOf(cond), bound: cond } : null
}

/** A number and its bound as the Condition it spells. */
export function numberCond(number: PostNumber, bound: MetricBound): PostCond {
  if (!isChannelPosts(number))
    return { type: "views", measure: number, ...bound }
  return { type: number, min: bound.min, max: bound.max }
}

/**
 * A Channel posts bound rounded inward to whole numbers, low end up and high
 * end down, so "<= 29.5" keeps exactly what "<= 29" keeps; `null` when no
 * whole number is left between its ends.
 */
export function wholeBound(bound: MetricBound): MetricBound | null {
  const min = bound.min === undefined ? undefined : Math.ceil(bound.min)
  const max = bound.max === undefined ? undefined : Math.floor(bound.max)
  if (min !== undefined && max !== undefined && min > max) return null
  return {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  }
}

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
  { label: "Is a reply", value: "is_reply" },
  { label: "Has a reply", value: "has_reply" },
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

export const measureLabel = (measure: PostNumber): string =>
  POST_NUMBER[measure].label

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
    case "channel_posts":
    case "channel_posts_filtered":
      return `${measureLabel(cond.type)} ${boundText(cond)}`
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
  if (isNumberCond(cond)) return boundWords(numberOf(cond), cond)
  return `${PREFIX[cond.type]}:${quote(cond.value)}`
}

const boundWords = (m: PostNumber, b: MetricBound): string =>
  ({
    none: `${m} = none`,
    between: `${m} ${b.min}..${b.max}`,
    gte: `${m} >= ${b.min}`,
    lte: `${m} <= ${b.max}`,
  })[boundKind(b)]

/**
 * The readable text form: `type:forwarded`, `media:photo`, `lang:fa`,
 * `channel:name`, `views >= 1000`, `estimated <= 500`, `views 100..1000`,
 * `views = none`, `channel_posts <= 5`, `channel_posts_filtered 10..30`,
 * `not`, `and`, `or` and parentheses.
 */
export const printPostFilter = (filter: PostFilter): string =>
  printTree(filter, condText)

const NUM = String.raw`(\d+(?:\.\d+)?(?:e[+-]?\d+)?)`
/**
 * `views >= 200`, `estimated 200..1000`, `views = none` or
 * `channel_posts <= 5`; a Channel posts bound has no `= none`.
 */
const BOUND = new RegExp(
  String.raw`^(views|estimated|channel_posts_filtered|channel_posts)(?:\s*(>=|<=|>|<)\s*${NUM}|\s*=\s*none(?![\p{L}\p{N}_])|\s+${NUM}\s*\.\.\s*${NUM})`,
  "iu",
)

function boundCond(m: RegExpExecArray): PostCond {
  const number = m[1].toLowerCase() as PostNumber
  // Inclusive, as on Channels: ">" reads as ">=" and "<" as "<=".
  const bound: MetricBound =
    m[4] !== undefined
      ? { min: Number(m[4]), max: Number(m[5]) }
      : m[2] === undefined
        ? { none: true }
        : m[2].startsWith(">")
          ? { min: Number(m[3]) }
          : { max: Number(m[3]) }
  if (!isChannelPosts(number))
    return { type: "views", measure: number, ...bound }
  if (bound.none) throw new ParseError(`${number} has no "none"`)
  return { type: number, ...bound }
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
