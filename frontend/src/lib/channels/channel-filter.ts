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
  addFunnel as addTreeFunnel,
  emptyTree,
  evalTree,
  flip,
  type Joiner,
  mapGroups,
  newId,
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

const WORD = /^[\p{L}\p{N}_.-]+$/u
/** Quoted when not a plain word, with `"` and `\` escaped by a backslash. */
const quote = (text: string) =>
  WORD.test(text) ? text : `"${text.replace(/["\\]/g, "\\$&")}"`

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

function nodeText(node: FilterNode, names: FilterNames, top: boolean): string {
  const not = node.not ? "not " : ""
  if (node.kind === "atom") return `${not}${condText(node.cond, names)}`
  const inner = node.children
    .map((child) => nodeText(child, names, false))
    .join(` ${node.op} `)
  if (node.not) return `not (${inner})`
  return top ? inner : `(${inner})`
}

/**
 * The readable text form: `tag:name`, `group:"Setting group name"`,
 * `lang:fa`, `reach >= 200`, `subscribers <= 100`, `reach 200..1000`,
 * `reach = none`, `not`, `and`, `or` and parentheses. A root holding one negated
 * group is parenthesised, so it reads back as that child and not as a
 * negated root.
 */
export function printChannelFilter(
  filter: ChannelFilter,
  names: FilterNames,
): string {
  const [only] = filter.children
  if (
    !filter.not &&
    filter.children.length === 1 &&
    only.kind === "group" &&
    only.not
  ) {
    return `(${nodeText(only, names, false)})`
  }
  return nodeText(filter, names, true)
}

type Token = { t: "(" | ")" | "and" | "or" | "not" } | { t: "atom"; cond: Cond }

class ParseError extends Error {}

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

function tokenize(raw: string, names: FilterNames): Token[] {
  // "tag tech" reads naturally, and is the same length as "tag:"; so is
  // "activity rate < 10" as "activity_rate". Quoted names are skipped, and so
  // is a key that is itself a value ("tag:lang").
  const src = raw.replace(
    /"(?:[^"\\]|\\.)*"|(?<![:\p{L}\p{N}_.-])(?:(tag|group|lang)\s+(?=["\p{L}\p{N}_])|(activity\s+rate)(?=\s*[<>=\d-]))/giu,
    (match, key?: string, activity?: string) =>
      key
        ? `${key}:`.padEnd(match.length)
        : activity
          ? "activity_rate".padEnd(match.length)
          : match,
  )
  const word = /^([a-z]+:)?(?:"((?:[^"\\]|\\.)*)"|([\p{L}\p{N}_.-]+))/iu
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === "(" || ch === ")") {
      out.push({ t: ch })
      i++
      continue
    }
    if (ch === "!") {
      out.push({ t: "not" })
      i++
      continue
    }
    if (ch === "&" || ch === "|") {
      out.push({ t: ch === "&" ? "and" : "or" })
      i += src[i + 1] === ch ? 2 : 1
      continue
    }
    const m = METRIC.exec(src.slice(i))
    if (m && isMetricKey(m[1].toLowerCase())) {
      out.push({ t: "atom", cond: metricCond(m) })
      i += m[0].length
      continue
    }
    const w = word.exec(src.slice(i))
    if (!w) throw new ParseError(`Unexpected ${ch}`)
    const prefix = w[1]?.slice(0, -1).toLowerCase()
    const text = w[2]?.replace(/\\(.)/g, "$1") ?? w[3]
    const lower = text.toLowerCase()
    if (
      !prefix &&
      w[3] &&
      (lower === "and" || lower === "or" || lower === "not")
    ) {
      out.push({ t: lower })
    } else if (prefix === "group") {
      out.push({
        t: "atom",
        cond: { type: "group", value: names.groupId(text) },
      })
    } else if (prefix === "lang") {
      out.push({ t: "atom", cond: { type: "language", value: text } })
    } else if (prefix && prefix !== "tag") {
      throw new ParseError(`Unknown ${prefix}:`)
    } else {
      // A bare word is a tag.
      out.push({ t: "atom", cond: { type: "tag", value: names.tagId(text) } })
    }
    i += w[0].length
  }
  return out
}

/** Whether the first token's parenthesis closes on the last token. */
function wholeIsParenthesised(tokens: Token[]): boolean {
  if (tokens[0]?.t !== "(") return false
  let depth = 0
  for (const [i, token] of tokens.entries()) {
    if (token.t === "(") depth++
    if (token.t === ")") depth--
    if (depth === 0) return i === tokens.length - 1
  }
  return false
}

/**
 * or-expr  := and-expr ("or" and-expr)*
 * and-expr := primary ("and"? primary)*
 * primary  := "not" primary | atom | "(" or-expr ")"
 * NOT binds tightest, then AND, then OR: "not a or b and c" is
 * "(not a) or (b and c)". Anything that does not parse is `null`, which the
 * tab ignores rather than showing as an error.
 */
export function parseChannelFilter(
  src: string,
  names: FilterNames,
): ChannelFilter | null {
  let tokens: Token[]
  try {
    tokens = tokenize(src, names)
  } catch (error) {
    if (error instanceof ParseError) return null
    throw error
  }
  if (tokens.length === 0) return emptyFilter()
  let i = 0
  const peek = () => tokens[i]?.t
  const group = (op: Joiner, children: FilterNode[]): FilterNode =>
    children.length === 1
      ? children[0]
      : { kind: "group", id: newId(), op, children }

  const primary = (): FilterNode | null => {
    const token = tokens[i++]
    if (token?.t === "not") {
      const inner = primary()
      return inner && { ...inner, not: !inner.not }
    }
    if (token?.t === "atom")
      return { kind: "atom", id: newId(), cond: token.cond }
    if (token?.t !== "(") return null
    const inner = orExpr()
    if (!inner || tokens[i++]?.t !== ")") return null
    return inner.kind === "group"
      ? inner
      : { kind: "group", id: newId(), op: "and", children: [inner] }
  }
  const andExpr = (): FilterNode | null => {
    const parts = [primary()]
    while (["and", "atom", "(", "not"].includes(peek() ?? "")) {
      if (peek() === "and") i++ // two Conditions side by side mean AND
      parts.push(primary())
    }
    return parts.every(Boolean) ? group("and", parts as FilterNode[]) : null
  }
  const orExpr = (): FilterNode | null => {
    const parts = [andExpr()]
    while (peek() === "or") {
      i++
      parts.push(andExpr())
    }
    return parts.every(Boolean) ? group("or", parts as FilterNode[]) : null
  }

  const body = orExpr()
  if (!body || i < tokens.length) return null
  const root: ChannelFilter =
    body.kind === "group" && !wholeIsParenthesised(tokens)
      ? { ...body, id: "root" }
      : { ...emptyFilter(), children: [body] }
  return opposeLoneGroups(root)
}

/**
 * Parentheses around one block ("(a)", as a chip put in parentheses by
 * itself prints) do not write their operator. They read back with the
 * opposite of their parent's, which is what wrapping gave them.
 */
const opposeLoneGroups = (root: ChannelFilter): ChannelFilter =>
  mapGroups(root, (group) => ({
    ...group,
    children: group.children.map((child) =>
      child.kind === "group" && child.children.length === 1
        ? { ...child, op: flip(group.op) }
        : child,
    ),
  }))
