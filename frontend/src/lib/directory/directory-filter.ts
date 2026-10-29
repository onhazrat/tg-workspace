/**
 * The Directory filter (DIR-02): which Directory entries the Directory tab
 * lists. It is the shared filter tree (`lib/filter-tree.ts`) over Directory
 * Conditions, and the server evaluates it, as it does the Post filter; the
 * browser never tests an entry.
 *
 * It lives in the workspace URL as `?dirFilter=`, in the shared grammar
 * (`lib/filter-text.ts`): `lang:fa`, `name:"news"` (a bare word too),
 * `is:followed`, `is:followable`, `subscribers >= 1000`, `reach 100..5000`,
 * `reach = none`, `mine:all`, `mine:-2w..`, with `not`, `and`, `or` and
 * parentheses. DIR-05 adds `citedby:` and `cites:`; DIR-07 adds
 * `parents:` and `children:` (`ticked`, `selection`, `follows` or typed
 * handles, a trailing number being the minimum). DFP-04 adds `tag:"news"`, In
 * the Tag, which the server resolves against the reader's own Tags. DFP-05
 * lets a Tag be the Seeds of all four: `parents:"tag:news 3"`,
 * `citedby:"tag:news"`; the old word `picked` still reads as `ticked`.
 * TGU-04 adds `group:"Slow"`, In the Setting group, a Seed source too
 * (`parents:"group:Slow"`); an old `tag:"group:Slow"` reads as it.
 * DPF adds `status:unavailable`, `kind:bot`, `error:"timeout"` and Time
 * bounds: `last_post_at -7d..` (Live, signed from now), `refresh_due_at
 * now..+2d`, `checked_at 2026-10-01T00:00Z..` (Fixed, a UTC instant), either
 * end open, `retry_after = none`. The day measures `last_post_days` and
 * `found_days` are gone and no longer parse. TB-02 makes `mine:`'s window a
 * Time bound on when the citing Posts were published, in the same form; an
 * old `mine:14d` still reads, as Live from 14 days ago with the End open.
 */

import type {
  DirectoryFilterAtom,
  DirectoryFilterGroup,
  DirectoryFlagCondition,
  DirectoryIsCondition,
  DirectoryMeasureCondition,
  DirectoryTimeCondition,
} from "@/client"
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
import { atoms, type FilterNode, type FilterTree } from "@/lib/filter-tree"
import { languageLabel } from "@/lib/language-name"
import { DAY_MS } from "@/lib/scope/window"
import type { TimeBound } from "@/lib/time-bound/bound"
import {
  parseTimeBound,
  TIME_BOUND,
  timeBoundText,
  timeBoundWords,
} from "@/lib/time-bound/text"

export type MeasureKey = DirectoryMeasureCondition["measure"]
export type MomentKey = DirectoryTimeCondition["moment"]
export type TimeMode = DirectoryTimeCondition["mode"]
export type IsField = DirectoryIsCondition["field"]
export type DirectoryFlag = DirectoryFlagCondition["value"]

/**
 * A Time bound (DPF), `[start, end)` on one moment, either end open. A Live
 * end is signed ms from now, negative for the past; a Fixed end is epoch ms.
 * `none` keeps only the entries with no value.
 */
export type DirectoryTimeCond = {
  type: "time"
  moment: MomentKey
  mode: TimeMode
  start?: number
  end?: number
  none?: true
}

/**
 * Cited by "your channels" (TB-02): ever, or within a Time bound on when the
 * citing Posts were published. Either end open, never No value.
 */
export type DirectoryMineCond = { type: "mine" } & Partial<TimeBound>

/** The Condition's window; `null` for every Post. */
export const mineBound = (cond: Partial<TimeBound>): TimeBound | null =>
  cond.mode && (cond.start !== undefined || cond.end !== undefined)
    ? {
        mode: cond.mode,
        ...(cond.start !== undefined && { start: cond.start }),
        ...(cond.end !== undefined && { end: cond.end }),
      }
    : null

export type DirectoryMeasureCond = {
  type: "measure"
  measure: MeasureKey
} & MetricBound

export type DirectoryCond =
  | { type: "language"; value: string }
  | { type: "name"; value: string }
  | { type: "flag"; value: DirectoryFlag }
  | DirectoryMineCond
  /** Cited by any of the Seeds, in the view's Reference kinds (DIR-05). */
  | { type: "citedby"; seeds: FixedSeeds }
  /** Cites any of the Seeds, in the view's Reference kinds (DIR-05). */
  | { type: "cites"; seeds: FixedSeeds }
  | DirectorySharedCond
  | DirectoryMeasureCond
  /** In the reader's Tag of this name; one they do not have matches nothing. */
  | { type: "tag"; name: string }
  /** The reader's Follows in their Setting group of this name (TGU-04). */
  | { type: "group"; name: string }
  /** The verdict or the kind is exactly `value` (DPF). */
  | { type: "is"; field: IsField; value: string }
  /** The last error contains `value`, case-insensitive (DPF). */
  | { type: "contains"; field: "last_error"; value: string }
  | DirectoryTimeCond

/**
 * Where a Condition's Seeds come from (DIR-07, DFP-05): the Channels ticked in
 * the list, the Channels tab selection or every follow, which the browser
 * resolves to handles as it sends the filter; a Tag, which the server
 * resolves; or typed handles. All but typed handles are live.
 */
export type SeedSource =
  | { kind: LiveSource }
  | { kind: "tag"; name: string }
  | { kind: "group"; name: string }
  | { kind: "handles"; handles: string[] }
export type LiveSource = "ticked" | "selection" | "follows"
/** Cited by and Cites take fixed handles or a Tag; the editor fills the handles. */
export type FixedSeeds = Extract<
  SeedSource,
  { kind: "tag" | "group" | "handles" }
>
/** Each live source's handles as they are now. */
export type SeedSets = Record<LiveSource, string[]>

/** Shared parents or Shared children with the Seeds, at least `min` shared. */
export type DirectorySharedCond = {
  type: "parents" | "children"
  seeds: SeedSource
  min: number
}

export type DirectoryHandlesCond = Extract<
  DirectoryCond,
  { type: "citedby" | "cites" }
>

export type DirectoryFilter = FilterTree<DirectoryCond>

export type MeasureSection =
  | "Size and activity"
  | "Content"
  | "References"
  | "Probe queue"

export type Measure = {
  key: MeasureKey
  label: string
  /** The column header. */
  short: string
  description: string
  section: MeasureSection
}

export type Moment = {
  key: MomentKey
  label: string
  description: string
  section: MeasureSection
}

/** An entry's moments, each a Time bound and a sort (DPF). */
export const MOMENTS: Moment[] = [
  {
    key: "last_post_at",
    label: "Last post",
    description: "When it last posted",
    section: "Size and activity",
  },
  {
    key: "created_at",
    label: "Found",
    description: "When the Directory first saw it",
    section: "Size and activity",
  },
  {
    key: "checked_at",
    label: "Checked",
    description: "When the Directory last got an answer about it",
    section: "Probe queue",
  },
  {
    key: "refresh_due_at",
    label: "Refresh due",
    description: "When the Directory will fetch it again",
    section: "Probe queue",
  },
  {
    key: "attempted_at",
    label: "Last attempt",
    description: "When the Directory last tried to fetch it, answered or not",
    section: "Probe queue",
  },
  {
    key: "retry_after",
    label: "Retry after",
    description: "When a fetch that got no answer may be tried again",
    section: "Probe queue",
  },
]
const MOMENT_BY_KEY = new Map(MOMENTS.map((m) => [m.key, m]))
export const momentOf = (key: MomentKey): Moment =>
  MOMENT_BY_KEY.get(key) as Moment

/** The values an "is" Condition offers, which are all the server writes. */
export const IS_VALUES: Record<IsField, readonly string[]> = {
  status: ["ok", "unavailable", "private", "unknown"],
  kind: ["channel", "group", "bot", "user", "unknown"],
}
export const IS_LABEL: Record<IsField, string> = {
  status: "Status",
  kind: "Kind",
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
    key: "sample_count",
    label: "Sample size",
    short: "Sample",
    description:
      "How many recent Posts the Directory sampled; Posts per week and Reach come from them",
    section: "Size and activity",
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
  {
    key: "attempts",
    label: "Attempts",
    short: "Attempts",
    description: "Fetches in a row that got no answer; reset by one that does",
    section: "Probe queue",
  },
  {
    key: "priority",
    label: "Priority",
    short: "Priority",
    description:
      "Its place in the probe queue as the Directory set it; lower goes first",
    section: "Probe queue",
  },
  {
    key: "priority_boost",
    label: "Priority boost",
    short: "Boost",
    description:
      "The Operator's adjustment to its place in the queue; positive fetches sooner",
    section: "Probe queue",
  },
  {
    key: "effective_priority",
    label: "Effective priority",
    short: "Effective",
    description:
      "Priority minus the boost, which is the order the Directory fetches in, lower first",
    section: "Probe queue",
  },
  {
    key: "telegram_chat_id",
    label: "Chat id",
    short: "Chat id",
    description: "Telegram's id for it, which survives a handle rename",
    section: "Probe queue",
  },
  {
    key: "latest_id",
    label: "Latest Post id",
    short: "Latest id",
    description: "The newest Post id the Directory saw",
    section: "Probe queue",
  },
]

const BY_KEY = new Map(MEASURES.map((m) => [m.key, m]))
export const measureOf = (key: MeasureKey): Measure =>
  BY_KEY.get(key) as Measure

export const FLAG_LABEL: Record<DirectoryFlag, string> = {
  followed: "Followed",
  followable: "Followable",
  dismissed: "Dismissed",
}

const MINE_LABEL = "Cited by your channels"

export const HANDLES_LABEL: Record<DirectoryHandlesCond["type"], string> = {
  citedby: "Cited by",
  cites: "Cites",
}

export const SHARED_LABEL: Record<DirectorySharedCond["type"], string> = {
  parents: "Shared parents",
  children: "Shared children",
}

const LIVE_LABEL: Record<LiveSource, string> = {
  ticked: "the channels selected here",
  selection: "your selected channels",
  follows: "your follows",
}

const atHandles = (handles: string[]) => handles.map((h) => `@${h}`).join(", ")

const TAG_SEEDS = "tag:"
const GROUP_SEEDS = "group:"

/** The Seeds as the wire takes them. */
export type WireSeeds =
  | { handles: string[] }
  | { tag: string }
  | { group: string }

/** One Seed source in each of the forms the Directory writes it. */
type SeedForms = {
  /** As a chip names them: "@a, @b", "the Tag news", "your follows". */
  label: string
  /** As the filter's text form writes them. */
  text: string
  /** A chip id's part. */
  id: string
  /**
   * As the wire takes them: a Tag by name, which the server resolves, or
   * handles, a live source's resolved against `sets` now.
   */
  wire: (sets: SeedSets) => WireSeeds
}

type SeedKind = SeedSource["kind"]
type SeedOf<K extends SeedKind> = K extends LiveSource
  ? { kind: K }
  : Extract<SeedSource, { kind: K }>

const liveSeeds = (seeds: { kind: LiveSource }): SeedForms => ({
  label: LIVE_LABEL[seeds.kind],
  text: seeds.kind,
  id: seeds.kind,
  wire: (sets) => ({ handles: sets[seeds.kind] }),
})

/** Each kind of Seed source's forms, the one place a kind is described. */
const SEED_FORMS: { [K in SeedKind]: (seeds: SeedOf<K>) => SeedForms } = {
  handles: ({ handles }) => ({
    label: atHandles(handles),
    text: handles.join(" "),
    id: handles.join("-"),
    wire: () => ({ handles }),
  }),
  tag: ({ name }) => ({
    label: `the Tag ${name}`,
    text: `${TAG_SEEDS}${name}`,
    id: `tag-${name}`,
    wire: () => ({ tag: name }),
  }),
  group: ({ name }) => ({
    label: `the Setting group ${name}`,
    text: `${GROUP_SEEDS}${name}`,
    id: `group-${name}`,
    wire: () => ({ group: name }),
  }),
  ticked: liveSeeds,
  selection: liveSeeds,
  follows: liveSeeds,
}

/** `seeds` in each of its forms. */
export const seedForms = (seeds: SeedSource): SeedForms =>
  // TypeScript cannot pair a union member's kind with its own entry.
  (SEED_FORMS[seeds.kind] as (seeds: SeedSource) => SeedForms)(seeds)

/** The Tag a Condition names, as In the Tag or as its Seeds; none otherwise. */
export function namedTag(cond: DirectoryCond): string | undefined {
  if (cond.type === "tag") return cond.name
  if ("seeds" in cond && cond.seeds.kind === "tag") return cond.seeds.name
  return undefined
}

/** The default minimum shared count. */
export const SHARED_MIN = 2

/** Typed handles as the server keys them: no "@", lowercase, each once. */
export const parseHandles = (text: string): string[] => [
  ...new Set(
    text
      .split(/[\s,]+/)
      .map((h) => h.replace(/^@/, "").toLowerCase())
      .filter(Boolean),
  ),
]

/** The tab's first view: what an Account neither follows nor dismissed, and can follow. */
export const OPENING_FILTER =
  "not is:followed and not is:dismissed and is:followable"

// ---- Labels ----------------------------------------------------------------

function timeLabel(
  cond: DirectoryTimeCond,
  locale?: string,
  timeZone?: string,
): string {
  return timeBoundWords(momentOf(cond.moment).label, cond, locale, timeZone)
}

/** A chip's label: "Persian", "Followed", "Subscribers ≥ 1K". */
export function directoryConditionLabel(
  cond: DirectoryCond,
  locale?: string,
  /** Fixed Time bounds read in the viewer's zone unless one is named. */
  timeZone?: string,
): string {
  switch (cond.type) {
    case "is":
      return `${IS_LABEL[cond.field]} is ${cond.value}`
    case "contains":
      return `Last error contains "${cond.value}"`
    case "time":
      return timeLabel(cond, locale, timeZone)
    case "language":
      return languageLabel(cond.value, locale)
    case "name":
      return `Name contains "${cond.value}"`
    case "tag":
      return `In the Tag ${cond.name}`
    case "group":
      return `In the Setting group ${cond.name}`
    case "flag":
      return FLAG_LABEL[cond.value]
    case "mine": {
      const window = mineBound(cond)
      return window
        ? timeBoundWords(MINE_LABEL, window, locale, timeZone)
        : MINE_LABEL
    }
    case "citedby":
    case "cites":
      return `${HANDLES_LABEL[cond.type]} ${seedForms(cond.seeds).label}`
    case "parents":
    case "children":
      return `${cond.min}+ shared ${cond.type} with ${seedForms(cond.seeds).label}`
    case "measure":
      return `${measureOf(cond.measure).label}${cond.none ? ":" : ""} ${boundText(cond)}`
  }
}

// ---- The text form ---------------------------------------------------------

function timeText(cond: DirectoryTimeCond): string {
  if (cond.none) return `${cond.moment} = none`
  return `${cond.moment} ${timeBoundText(cond)}`
}

function condText(cond: DirectoryCond): string {
  switch (cond.type) {
    case "is":
      return `${cond.field}:${quote(cond.value)}`
    case "contains":
      return `error:${quote(cond.value)}`
    case "time":
      return timeText(cond)
    case "language":
      return `lang:${quote(cond.value)}`
    case "name":
      return `name:${quote(cond.value)}`
    case "tag":
    case "group":
      return `${cond.type}:${quote(cond.name)}`
    case "flag":
      return `is:${cond.value}`
    case "mine": {
      const window = mineBound(cond)
      return `mine:${window ? quote(timeBoundText(window)) : "all"}`
    }
    case "citedby":
    case "cites":
      return `${cond.type}:${quote(seedForms(cond.seeds).text)}`
    case "parents":
    case "children": {
      const words = [seedForms(cond.seeds).text]
      // A Tag name ending in a number would read back as the minimum.
      const ambiguous =
        (cond.seeds.kind === "tag" || cond.seeds.kind === "group") &&
        TRAILING_MIN.test(words[0])
      if (cond.min !== SHARED_MIN || ambiguous) words.push(String(cond.min))
      return `${cond.type}:${quote(words.join(" "))}`
    }
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

const TRAILING_MIN = /(?:^|\s)(\d+)$/

export const printDirectoryFilter = (filter: DirectoryFilter): string =>
  printTree(filter, condText)

// Signed, since the probe queue's numbers go negative (DPF).
const NUM = String.raw`(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)`
const BOUND = new RegExp(
  String.raw`^([a-z_]+)(?:\s*(>=|<=|>|<)\s*${NUM}|\s*=\s*none(?![\p{L}\p{N}_])|\s+${NUM}\s*\.\.\s*${NUM})`,
  "iu",
)

function boundCond(m: RegExpExecArray): DirectoryMeasureCond {
  const measure = m[1].toLowerCase() as MeasureKey
  // A bound on something that is not a measure, such as the day measures
  // DPF removed, would otherwise read on as Name contains words.
  if (!BY_KEY.has(measure)) throw new ParseError(`Unknown measure ${measure}`)
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

const TIME = new RegExp(
  String.raw`^(${MOMENTS.map((m) => m.key).join("|")})(?:\s*=\s*none(?![\p{L}\p{N}_])|\s+${TIME_BOUND}(?![\p{L}\p{N}_.]))`,
  "iu",
)

function timeCond(m: RegExpExecArray): DirectoryTimeCond {
  const moment = m[1].toLowerCase() as MomentKey
  if (m[2] === undefined && m[3] === undefined && !m[0].includes(".."))
    return { type: "time", moment, mode: "fixed", none: true }
  return { type: "time", moment, ...parseTimeBound(m[2], m[3]) }
}

const FLAGS = new Set<string>(Object.keys(FLAG_LABEL))
/** The live source words, and the one a link written before DFP-05 used. */
const SOURCES: Record<string, LiveSource> = {
  ticked: "ticked",
  selection: "selection",
  follows: "follows",
  picked: "ticked",
}

/**
 * `tag:<name>`'s or `group:<name>`'s value as a Tag or a Setting group: an old
 * `group:` Tag is the group (TGU-04). `null` for no name.
 */
function namedCond(
  type: "tag" | "group",
  text: string,
): { type: "tag" | "group"; name: string } | null {
  const old = type === "tag" && text.toLowerCase().startsWith(GROUP_SEEDS)
  const name = old ? text.slice(GROUP_SEEDS.length).trim() : text
  return name.trim() ? { type: old ? "group" : type, name } : null
}

/** `tag:<name>`, `group:<name>` or handles; `null` for no name or no handle. */
function fixedSeeds(text: string): FixedSeeds | null {
  for (const type of ["tag", "group"] as const) {
    if (!text.startsWith(`${type}:`)) continue
    const named = namedCond(type, text.slice(type.length + 1).trim())
    return named && { kind: named.type, name: named.name }
  }
  const handles = parseHandles(text)
  return handles.length ? { kind: "handles", handles } : null
}

/**
 * `parents:` / `children:`'s value: a source word, `tag:<name>` or handles,
 * then maybe the minimum. ponytail: a typed handle spelled like a source word
 * (`follows`) reads as that source; Telegram allows such a handle, nobody has
 * asked.
 */
function sharedCond(
  type: DirectorySharedCond["type"],
  text: string,
): DirectorySharedCond | null {
  const trimmed = text.trim()
  const trailing = TRAILING_MIN.exec(trimmed)
  const min = trailing ? Number(trailing[1]) : SHARED_MIN
  const rest = trailing ? trimmed.slice(0, trailing.index).trim() : trimmed
  if (min < 1) return null
  const source = SOURCES[rest]
  if (source) return { type, seeds: { kind: source }, min }
  const seeds = fixedSeeds(rest)
  return seeds && { type, seeds, min }
}
/** A link written before TB-02: the last so many days. */
const OLD_WINDOW = /^(\d+)d$/
const MINE_WINDOW = new RegExp(`^${TIME_BOUND}$`, "iu")

function mineCond(text: string): DirectoryMineCond | null {
  if (text === "all") return { type: "mine" }
  const days = Number(OLD_WINDOW.exec(text)?.[1])
  if (days >= 1) return { type: "mine", mode: "live", start: -days * DAY_MS }
  const m = MINE_WINDOW.exec(text)
  return m && { type: "mine", ...parseTimeBound(m[1], m[2]) }
}

const DIRECTORY_TEXT: TextVocabulary<DirectoryCond> = {
  bound: (rest) => {
    const t = TIME.exec(rest)
    if (t) return { cond: timeCond(t), length: t[0].length }
    const m = BOUND.exec(rest)
    const cond = m && boundCond(m)
    return m && cond ? { cond, length: m[0].length } : null
  },
  word: (prefix, text) => {
    // A bare word reads as Name contains, so typing "news" does something.
    if (prefix === "name" || prefix === undefined)
      return { type: "name", value: text }
    if (prefix === "lang") return { type: "language", value: text }
    if (prefix === "tag" || prefix === "group") {
      const cond = namedCond(prefix, text)
      if (cond) return cond
    }
    if (prefix === "is" && FLAGS.has(text))
      return { type: "flag", value: text as DirectoryFlag }
    if (
      (prefix === "status" || prefix === "kind") &&
      IS_VALUES[prefix].includes(text)
    )
      return { type: "is", field: prefix, value: text }
    if (prefix === "error" && text.trim())
      return { type: "contains", field: "last_error", value: text }
    if (prefix === "mine") {
      const cond = mineCond(text)
      if (cond) return cond
    }
    if (prefix === "citedby" || prefix === "cites") {
      const seeds = fixedSeeds(text.trim())
      if (seeds)
        return prefix === "cites"
          ? { type: "cites", seeds }
          : { type: "citedby", seeds }
    }
    if (prefix === "parents" || prefix === "children") {
      const cond = sharedCond(prefix, text)
      if (cond) return cond
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
  /** A Live end's reach either way, a century, as the server's. */
  liveReach: 100 * 366 * DAY_MS,
  /** Cited by and Cites: fixed handles per Condition; past it, use a Tag. */
  handles: 500,
  handleLength: 256,
  /** Shared parents / children: Seeds per Condition, and the minimum. */
  seeds: 10_000,
  min: 10_000,
} as const

const seedsFit = (seeds: SeedSource, most: number) =>
  seeds.kind !== "handles" ||
  (seeds.handles.length <= most &&
    seeds.handles.every(
      (h) => h.length <= DIRECTORY_FILTER_BOUNDS.handleLength,
    ))

const withinReach = ({ start, end }: Partial<TimeBound>) =>
  [start, end].every(
    (ms) =>
      ms === undefined || Math.abs(ms) <= DIRECTORY_FILTER_BOUNDS.liveReach,
  )

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
    if (cond.type === "name" || cond.type === "contains")
      return cond.value.length <= b.nameLength
    if (cond.type === "mine" || cond.type === "time")
      return cond.mode !== "live" || withinReach(cond)
    if (cond.type === "citedby" || cond.type === "cites")
      return seedsFit(cond.seeds, b.handles)
    if (cond.type === "parents" || cond.type === "children")
      return seedsFit(cond.seeds, b.seeds) && cond.min <= b.min
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

/** One Condition as the wire takes it: its Seeds as handles or a Tag. */
function wireCond(
  cond: DirectoryCond,
  sets: SeedSets,
): DirectoryFilterAtom["cond"] {
  if (cond.type === "citedby" || cond.type === "cites")
    return { type: cond.type, ...seedForms(cond.seeds).wire(sets) }
  if (cond.type === "parents" || cond.type === "children")
    return {
      type: cond.type,
      ...seedForms(cond.seeds).wire(sets),
      min: cond.min,
    }
  return cond
}

const toWire = (
  node: FilterNode<DirectoryCond>,
  sets: SeedSets,
): DirectoryFilterAtom | DirectoryFilterGroup =>
  node.kind === "atom"
    ? { ...node, cond: wireCond(node.cond, sets) }
    : { ...node, children: node.children.map((c) => toWire(c, sets)) }

/**
 * The tree as the Directory reads take it, or `null` for an empty one. The
 * live Seeds are resolved here, so they follow the ticks, the selection and
 * the follows on every read (DIR-07); a Tag goes by name.
 */
export const directoryFilterBody = (
  filter: DirectoryFilter,
  sets: SeedSets,
): DirectoryFilterGroup | null =>
  filter.children.length === 0
    ? null
    : (toWire(filter, sets) as DirectoryFilterGroup)

/** The first Shared Condition of `type`, whose Seeds a column and Why read. */
export const firstShared = (
  filter: DirectoryFilter,
  type: DirectorySharedCond["type"],
): DirectorySharedCond | undefined =>
  atoms(filter)
    .map((a) => a.cond)
    .find((c): c is DirectorySharedCond => c.type === type)

/** The Shared relations the filter has on, for the sort picker. */
export const sharedOn = (filter: DirectoryFilter) =>
  (["parents", "children"] as const).filter((r) => firstShared(filter, r))
