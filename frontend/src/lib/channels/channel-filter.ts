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
import { languageName } from "@/lib/language-name"
import type { Channel } from "@/types"

export type CondType = "tag" | "group" | "language"
/** A `tag` value may be one of the derived tag ids. */
export type ValueCond = { type: CondType; value: string }
/** A bound on a number; `none` passes only a Channel with no value. */
export type MetricCond = { type: "metric"; metric: MetricKey } & MetricBound
export type Cond = ValueCond | MetricCond
export type Joiner = "and" | "or"

export type AtomNode = { kind: "atom"; id: string; cond: Cond; not?: boolean }
export type MetricAtom = AtomNode & { cond: MetricCond }
export type GroupNode = {
  kind: "group"
  id: string
  op: Joiner
  not?: boolean
  children: FilterNode[]
}
export type FilterNode = AtomNode | GroupNode
/** The root is always a group, with the id `root`. */
export type ChannelFilter = GroupNode

let seq = 0
const newId = () => `n${++seq}`

export const emptyFilter = (): ChannelFilter => ({
  kind: "group",
  id: "root",
  op: "and",
  children: [],
})

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

function evalNode(
  node: FilterNode,
  channel: Channel,
  inputs: MetricInputs,
): boolean {
  if (node.kind === "group" && node.children.length === 0) return true
  const result =
    node.kind === "atom"
      ? testCond(node.cond, channel, inputs)
      : node.op === "and"
        ? node.children.every((child) => evalNode(child, channel, inputs))
        : node.children.some((child) => evalNode(child, channel, inputs))
  return node.not ? !result : result
}

export const matchesChannelFilter = (
  filter: ChannelFilter,
  channel: Channel,
  inputs: MetricInputs,
): boolean => evalNode(filter, channel, inputs)

// ---- Reading the tree ------------------------------------------------------

export function atoms(node: FilterNode): AtomNode[] {
  return node.kind === "atom" ? [node] : node.children.flatMap(atoms)
}

function find(node: FilterNode, id: string): FilterNode | null {
  if (node.id === id) return node
  if (node.kind === "atom") return null
  for (const child of node.children) {
    const hit = find(child, id)
    if (hit) return hit
  }
  return null
}

function parentOf(
  root: GroupNode,
  id: string,
): { parent: GroupNode; index: number } | null {
  const index = root.children.findIndex((child) => child.id === id)
  if (index >= 0) return { parent: root, index }
  for (const child of root.children) {
    if (child.kind !== "group") continue
    const hit = parentOf(child, id)
    if (hit) return hit
  }
  return null
}

// ---- Editing ---------------------------------------------------------------

/** Rebuild the tree bottom up, letting `fn` replace any group. */
function mapGroups(
  group: GroupNode,
  fn: (group: GroupNode) => GroupNode,
): GroupNode {
  return fn({
    ...group,
    children: group.children.map((child) =>
      child.kind === "group" ? mapGroups(child, fn) : child,
    ),
  })
}

const withoutNode = (root: ChannelFilter, id: string) =>
  mapGroups(root, (group) => ({
    ...group,
    children: group.children.filter((child) => child.id !== id),
  }))

/**
 * Drop empty groups and unwrap one-child groups, so a remove or a move never
 * leaves "()" or "(a)" behind. Unwrapping keeps the negation: "not (a)" is
 * "not a", and "not (not a)" is "a". The root stays a group.
 */
function prune(root: ChannelFilter): ChannelFilter {
  return mapGroups(root, (group) => ({
    ...group,
    children: group.children
      .filter((child) => child.kind === "atom" || child.children.length > 0)
      .map((child) =>
        child.kind === "group" && child.children.length === 1
          ? {
              ...child.children[0],
              not: !!child.children[0].not !== !!child.not,
            }
          : child,
      ),
  }))
}

function insertAt(
  root: ChannelFilter,
  parentId: string,
  index: number,
  node: FilterNode,
): ChannelFilter {
  return mapGroups(root, (group) =>
    group.id === parentId
      ? {
          ...group,
          children: [
            ...group.children.slice(0, index),
            node,
            ...group.children.slice(index),
          ],
        }
      : group,
  )
}

export function append(
  root: ChannelFilter,
  parentId: string,
  cond: Cond,
): ChannelFilter {
  const parent = find(root, parentId)
  const at = parent?.kind === "group" ? parent.children.length : 0
  return insertAt(root, parentId, at, { kind: "atom", id: newId(), cond })
}

export const removeNode = (root: ChannelFilter, id: string): ChannelFilter =>
  prune(withoutNode(root, id))

export function replaceNode(
  root: ChannelFilter,
  id: string,
  next: FilterNode,
): ChannelFilter {
  if (root.id === id && next.kind === "group") return { ...next, id: "root" }
  return mapGroups(root, (group) => ({
    ...group,
    children: group.children.map((child) => (child.id === id ? next : child)),
  }))
}

/** Give Condition `id` a new Condition, keeping its NOT. */
export function replaceCond(
  root: ChannelFilter,
  id: string,
  cond: Cond,
): ChannelFilter {
  const node = find(root, id)
  return node?.kind === "atom" ? replaceNode(root, id, { ...node, cond }) : root
}

export const setOp = (
  root: ChannelFilter,
  groupId: string,
  op: Joiner,
): ChannelFilter =>
  mapGroups(root, (group) => (group.id === groupId ? { ...group, op } : group))

/** Flip one node's NOT; the root may be negated too. */
export function toggleNot(root: ChannelFilter, id: string): ChannelFilter {
  if (root.id === id) return { ...root, not: !root.not }
  return mapGroups(root, (group) => ({
    ...group,
    children: group.children.map((child) =>
      child.id === id ? { ...child, not: !child.not } : child,
    ),
  }))
}

/**
 * Move `id` to `index` inside `parentId`, the index read against the parent
 * as it is before the move. A group cannot move into itself.
 */
export function moveNode(
  root: ChannelFilter,
  id: string,
  parentId: string,
  index: number,
): ChannelFilter {
  const node = find(root, id)
  if (!node || find(node, parentId)) return root
  const from = parentOf(root, id)
  const shift =
    from && from.parent.id === parentId && from.index < index ? 1 : 0
  return prune(insertAt(withoutNode(root, id), parentId, index - shift, node))
}

/** Put `id` in parentheses of its own, where it was. */
export function wrap(
  root: ChannelFilter,
  id: string,
  op: Joiner,
): ChannelFilter {
  const node = find(root, id)
  if (!node || node.id === root.id) return root
  return replaceNode(root, id, {
    kind: "group",
    id: newId(),
    op,
    children: [node],
  })
}

/**
 * Drop `dragId` onto `targetId`: both go in new parentheses where the target
 * was, joined by the opposite of the parent's operator, since that is why one
 * groups.
 */
export function groupWith(
  root: ChannelFilter,
  dragId: string,
  targetId: string,
): ChannelFilter {
  if (dragId === targetId) return root
  const drag = find(root, dragId)
  const target = find(root, targetId)
  if (!drag || !target || find(drag, targetId)) return root
  const op: Joiner =
    parentOf(root, targetId)?.parent.op === "and" ? "or" : "and"
  return prune(
    replaceNode(withoutNode(root, dragId), targetId, {
      kind: "group",
      id: newId(),
      op,
      children: [target, drag],
    }),
  )
}

/**
 * Remove a group's parentheses, splicing its children into its parent. The
 * editor never offers it on a negated group, since dropping the parentheses
 * of "not (a or b)" would change what it means.
 */
export function unwrap(root: ChannelFilter, groupId: string): ChannelFilter {
  return prune(
    mapGroups(root, (group) => ({
      ...group,
      children: group.children.flatMap((child) =>
        child.id === groupId && child.kind === "group"
          ? child.children
          : [child],
      ),
    })),
  )
}

// ---- Funnels ---------------------------------------------------------------

/** The values of `type` that appear in a Condition anywhere in the tree. */
export const funnelledValues = (
  filter: ChannelFilter,
  type: CondType,
): string[] => [
  ...new Set(
    atoms(filter).flatMap((a) =>
      a.cond.type !== "metric" && a.cond.type === type ? [a.cond.value] : [],
    ),
  ),
]

const isFunnelOr = (node: FilterNode, type: CondType) =>
  node.kind === "group" &&
  !node.not &&
  node.op === "or" &&
  node.children.length > 0 &&
  node.children.every(
    (child) => child.kind === "atom" && !child.not && child.cond.type === type,
  )

/** The filter as a plain AND root, wrapping it when it is an OR or negated. */
function andRoot(filter: ChannelFilter): ChannelFilter {
  if (filter.children.length === 0) return emptyFilter()
  if (!filter.not && (filter.op === "and" || filter.children.length === 1)) {
    return { ...filter, op: "and" }
  }
  return { ...emptyFilter(), children: [{ ...filter, id: newId() }] }
}

/**
 * A dropdown funnel. Funnels in one dropdown join with OR and different
 * dropdowns with AND: the first of a type appends to the root, the second
 * puts the root-level one and itself in an OR group, later ones join it.
 */
export function addFunnel(
  filter: ChannelFilter,
  type: CondType,
  value: string,
): ChannelFilter {
  if (funnelledValues(filter, type).includes(value)) return filter
  const cond = { type, value }
  if (isFunnelOr(filter, type)) return append(filter, "root", cond)
  const base = andRoot(filter)
  const or = base.children.find((child) => isFunnelOr(child, type))
  if (or) return append(base, or.id, cond)
  const lone = base.children.find(
    (child) => child.kind === "atom" && !child.not && child.cond.type === type,
  )
  if (!lone) return append(base, "root", cond)
  return replaceNode(base, lone.id, {
    kind: "group",
    id: newId(),
    op: "or",
    children: [lone, { kind: "atom", id: newId(), cond }],
  })
}

function removeWhere(
  filter: ChannelFilter,
  drop: (cond: Cond) => boolean,
): ChannelFilter {
  return prune(
    mapGroups(filter, (group) => ({
      ...group,
      children: group.children.filter(
        (child) => child.kind === "group" || !drop(child.cond),
      ),
    })),
  )
}

/** Unfunnelling removes every Condition with that value. */
export const removeFunnel = (
  filter: ChannelFilter,
  type: CondType,
  value: string,
): ChannelFilter =>
  removeWhere(filter, (cond) => cond.type === type && cond.value === value)

export const clearFunnels = (
  filter: ChannelFilter,
  type: CondType,
): ChannelFilter => removeWhere(filter, (cond) => cond.type === type)

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
  return top || node.children.length < 2 ? inner : `(${inner})`
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
  return prune(root)
}
