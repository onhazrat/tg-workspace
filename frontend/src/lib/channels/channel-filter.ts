/**
 * The Channel filter (CTB-01): which Channels the Channels tab shows. It is a
 * tree, so parentheses are just groups:
 *   (tag tech and lang fa) or (tag news and not group slow)
 * is OR[ AND[tech, fa], AND[news, NOT slow] ]. Any node can be negated, and
 * an empty group passes every Channel, negated or not, so an empty filter
 * hides nothing.
 *
 * It lives in the workspace URL as the text form below. It is not part of the
 * Scope and never touches the selection. Recovered from the prototype's
 * `tree.ts` (commit e4d5002). The number Conditions (CTB-02) bound a metric,
 * and a Channel with no value for it fails every bound.
 *
 * The tree and its editing are `lib/filter-tree.ts` (PTR-01), shared with the
 * Posts tab; this module keeps what is Channel's own: the Conditions, their
 * test, their labels and the text form. The tree's names are re-exported so
 * every caller still imports them from here.
 */

import {
  boundKind,
  boundText,
  inBound,
  isMetricKey,
  type MetricBound,
  type MetricInputs,
  type MetricKey,
  metric,
  metricValue,
} from "@/lib/channels/channel-metrics"
import { getTagNames } from "@/lib/channels/channel-tag-model"
import {
  CHANNEL_PSEUDO_TAGS,
  findChannelPseudoTag,
} from "@/lib/channels/channel-tags"
import {
  ParseError,
  parseTree,
  printTree,
  quote,
  type TextVocabulary,
} from "@/lib/filter-text"
import {
  addFunnel as addTreeFunnel,
  emptyTree,
  evalTree,
  type Joiner,
  type AtomNode as TreeAtom,
  type GroupNode as TreeGroup,
  type FilterNode as TreeNode,
} from "@/lib/filter-tree"
import { languageName } from "@/lib/language-name"
import type { Channel } from "@/types"

export type CondType = "tag" | "group" | "language"
/** A `tag` value may be one of the derived tag ids. */
export type ValueCond = { type: CondType; value: string }
/** A bound on a number; `none` passes only a Channel with no value. */
export type MetricCond = { type: "metric"; metric: MetricKey } & MetricBound
export type Cond = ValueCond | MetricCond
export type { Joiner }

// The tree itself is `lib/filter-tree.ts`, shared with the Posts tab; these
// are its node types over the Channels' Conditions.
export type AtomNode = TreeAtom<Cond>
export type MetricAtom = AtomNode & { cond: MetricCond }
export type GroupNode = TreeGroup<Cond>
export type FilterNode = TreeNode<Cond>
/** The root is always a group, with the id `root`. */
export type ChannelFilter = GroupNode

export {
  append,
  atoms,
  clearFunnels,
  flip,
  funnelledValues,
  groupWith,
  moveNode,
  removeFunnel,
  removeNode,
  replaceCond,
  replaceNode,
  setOp,
  toggleNot,
  unwrap,
  wrap,
} from "@/lib/filter-tree"

export const emptyFilter = (): ChannelFilter => emptyTree<Cond>()

// ---- Evaluation ------------------------------------------------------------

function testCond(cond: Cond, channel: Channel, inputs: MetricInputs): boolean {
  switch (cond.type) {
    case "tag": {
      const derived = findChannelPseudoTag(cond.value)
      return derived
        ? derived.matches(channel)
        : getTagNames(channel.tags).includes(cond.value)
    }
    case "group":
      return channel.settingGroupId === cond.value
    case "language":
      return channel.language === cond.value
    case "metric":
      return inBound(metricValue(cond.metric, channel, inputs), cond)
  }
}

export const matchesChannelFilter = (
  filter: ChannelFilter,
  channel: Channel,
  inputs: MetricInputs,
): boolean => evalTree(filter, (cond) => testCond(cond, channel, inputs))

/**
 * A dropdown funnel. Funnels in one dropdown join with OR and different
 * dropdowns with AND (`filter-tree.ts::addFunnel`).
 */
export const addFunnel = (
  filter: ChannelFilter,
  type: CondType,
  value: string,
): ChannelFilter => addTreeFunnel<Cond>(filter, { type, value })

// ---- The URL form ----------------------------------------------------------

export type FilterNames = {
  groupName: (id: string) => string
  /**
   * A Setting group by name, or by id so a renamed group's old link resolves.
   * One this Account lacks, or has not loaded yet, keeps its text, so it
   * matches nothing and prints back unchanged.
   */
  groupId: (nameOrId: string) => string
  tagLabel: (id: string) => string
  tagId: (label: string) => string
}

export function filterNames(
  groups: readonly { id: string; name: string }[],
): FilterNames {
  return {
    groupName: (id) => groups.find((g) => g.id === id)?.name ?? id,
    groupId: (text) =>
      groups.find((g) => g.name.toLowerCase() === text.toLowerCase())?.id ??
      groups.find((g) => g.id === text)?.id ??
      text,
    tagLabel: (id) => findChannelPseudoTag(id)?.label ?? id,
    tagId: (label) =>
      CHANNEL_PSEUDO_TAGS.find(
        (t) => t.label.toLowerCase() === label.toLowerCase(),
      )?.id ?? label,
  }
}

/**
 * A Condition chip's label: the tag, Setting group or Language by name, or a
 * number's bound, "Reach ≥ 1.2K".
 */
export function conditionLabel(cond: Cond, names: FilterNames): string {
  switch (cond.type) {
    case "tag":
      return names.tagLabel(cond.value)
    case "group":
      return names.groupName(cond.value)
    case "language":
      return languageName(cond.value)
    case "metric":
      return `${metric(cond.metric).label}${cond.none ? ":" : ""} ${boundText(cond)}`
  }
}

function condText(cond: Cond, names: FilterNames): string {
  switch (cond.type) {
    case "tag":
      return `tag:${quote(names.tagLabel(cond.value))}`
    case "group":
      return `group:${quote(names.groupName(cond.value))}`
    case "language":
      return `lang:${quote(cond.value)}`
    case "metric":
      return {
        none: `${cond.metric} = none`,
        between: `${cond.metric} ${cond.min}..${cond.max}`,
        gte: `${cond.metric} >= ${cond.min}`,
        lte: `${cond.metric} <= ${cond.max}`,
      }[boundKind(cond)]
  }
}

/**
 * The readable text form: `tag:name`, `group:"Setting group name"`,
 * `lang:fa`, `reach >= 200`, `subscribers <= 100`, `reach 200..1000`,
 * `reach = none`, `not`, `and`, `or` and parentheses
 * (`lib/filter-text.ts`).
 */
export const printChannelFilter = (
  filter: ChannelFilter,
  names: FilterNames,
): string => printTree(filter, (cond) => condText(cond, names))

const NUM = String.raw`(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)`
/** `reach >= 200`, `reach 200..1000` or `reach = none`. */
const METRIC = new RegExp(
  String.raw`^([a-z_]+)(?:\s*(>=|<=|>|<)\s*${NUM}|\s*=\s*none(?![\p{L}\p{N}_])|\s+${NUM}\s*\.\.\s*${NUM})`,
  "iu",
)

function metricCond(m: RegExpExecArray): MetricCond {
  const key = m[1].toLowerCase() as MetricKey
  if (m[4] !== undefined)
    return { type: "metric", metric: key, min: Number(m[4]), max: Number(m[5]) }
  if (m[2] === undefined) return { type: "metric", metric: key, none: true }
  // Every bound is inclusive, so ">" reads as ">=" and "<" as "<=". The
  // printer writes only the inclusive forms.
  return m[2].startsWith(">")
    ? { type: "metric", metric: key, min: Number(m[3]) }
    : { type: "metric", metric: key, max: Number(m[3]) }
}

function channelText(names: FilterNames): TextVocabulary<Cond> {
  return {
    bound: (rest) => {
      const m = METRIC.exec(rest)
      return m && isMetricKey(m[1].toLowerCase())
        ? { cond: metricCond(m), length: m[0].length }
        : null
    },
    word: (prefix, text) => {
      if (prefix === "group")
        return { type: "group", value: names.groupId(text) }
      if (prefix === "lang") return { type: "language", value: text }
      if (prefix && prefix !== "tag") throw new ParseError(`Unknown ${prefix}:`)
      // A bare word is a tag.
      return { type: "tag", value: names.tagId(text) }
    },
  }
}

/**
 * The text form back as a filter (`lib/filter-text.ts::parseTree`); anything
 * that does not parse is `null`, which the tab ignores rather than showing as
 * an error.
 */
export function parseChannelFilter(
  src: string,
  names: FilterNames,
): ChannelFilter | null {
  // "tag tech" reads naturally, and is the same length as "tag:"; so is
  // "activity rate < 10" as "activity_rate". Quoted names are skipped, and so
  // is a key that is itself a value ("tag:lang").
  const normalised = src.replace(
    /"(?:[^"\\]|\\.)*"|(?<![:\p{L}\p{N}_.-])(?:(tag|group|lang)\s+(?=["\p{L}\p{N}_])|(activity\s+rate)(?=\s*[<>=\d-]))/giu,
    (match, key?: string, activity?: string) =>
      key
        ? `${key}:`.padEnd(match.length)
        : activity
          ? "activity_rate".padEnd(match.length)
          : match,
  )
  return parseTree(normalised, channelText(names))
}
