/**
 * PROTOTYPE, throwaway: filters as a nested expression, for T1-T3. A group
 * holds conditions and other groups joined by one operator, so parentheses
 * are just groups:
 *   (tag tech AND reach ≥ 200) OR (tag news AND (subs ≥ 100 OR reach ≥ 1000))
 * is OR[ AND[tech, reach], AND[news, OR[subs, reach]] ]. The same tag or
 * metric may appear any number of times, anywhere.
 */
import { getTagNames } from "@/lib/channels/channel-tag-model"
import { findChannelPseudoTag } from "@/lib/channels/channel-tags"
import type { Channel } from "@/types"
import type { Joiner } from "./logic"
import {
  formatNumber,
  METRICS,
  type MetricInputs,
  type MetricKey,
  metric,
  passesNumericFilters,
} from "./metrics"

export type Cond =
  | { type: "tag"; value: string }
  | { type: "group"; value: string }
  | { type: "language"; value: string }
  | { type: "metric"; metric: MetricKey; min?: number; max?: number }

export type AtomNode = { kind: "atom"; id: string; cond: Cond }
export type GroupNode = {
  kind: "group"
  id: string
  op: Joiner
  children: FilterNode[]
}
export type FilterNode = AtomNode | GroupNode

let seq = 0
export const newId = () => `n${++seq}`
export const emptyTree = (): GroupNode => ({
  kind: "group",
  id: "root",
  op: "and",
  children: [],
})

const hasTag = (c: Channel, tag: string) => {
  const pseudo = findChannelPseudoTag(tag)
  return pseudo ? pseudo.matches(c) : getTagNames(c.tags).includes(tag)
}

export function testCond(cond: Cond, c: Channel, inputs: MetricInputs) {
  switch (cond.type) {
    case "tag":
      return hasTag(c, cond.value)
    case "group":
      return c.settingGroupId === cond.value
    case "language":
      return c.language === cond.value
    case "metric":
      return passesNumericFilters(c, [cond], inputs)
  }
}

/** An empty group passes everything, so an empty tree filters nothing. */
export function evalNode(
  n: FilterNode,
  c: Channel,
  inputs: MetricInputs,
): boolean {
  if (n.kind === "atom") return testCond(n.cond, c, inputs)
  if (n.children.length === 0) return true
  return n.op === "and"
    ? n.children.every((ch) => evalNode(ch, c, inputs))
    : n.children.some((ch) => evalNode(ch, c, inputs))
}

export function atoms(n: FilterNode): AtomNode[] {
  return n.kind === "atom" ? [n] : n.children.flatMap(atoms)
}

export function find(n: FilterNode, id: string): FilterNode | null {
  if (n.id === id) return n
  if (n.kind === "atom") return null
  for (const ch of n.children) {
    const hit = find(ch, id)
    if (hit) return hit
  }
  return null
}

export function parentOf(
  root: GroupNode,
  id: string,
): { parent: GroupNode; index: number } | null {
  const i = root.children.findIndex((c) => c.id === id)
  if (i >= 0) return { parent: root, index: i }
  for (const ch of root.children)
    if (ch.kind === "group") {
      const hit = parentOf(ch, id)
      if (hit) return hit
    }
  return null
}

/** Rebuild the tree, letting `fn` replace any group's children. */
function mapGroups(g: GroupNode, fn: (g: GroupNode) => GroupNode): GroupNode {
  return fn({
    ...g,
    children: g.children.map((c) =>
      c.kind === "group" ? mapGroups(c, fn) : c,
    ),
  })
}

/**
 * Drop empty groups and unwrap one-child groups, so removing or moving a
 * condition never leaves "()" or "(a)" behind. The root stays a group.
 */
export function prune(root: GroupNode): GroupNode {
  return mapGroups(root, (g) => ({
    ...g,
    children: g.children
      .filter((c) => c.kind === "atom" || c.children.length > 0)
      .map((c) =>
        c.kind === "group" && c.children.length === 1 ? c.children[0] : c,
      ),
  }))
}

export function insertAt(
  root: GroupNode,
  parentId: string,
  index: number,
  node: FilterNode,
): GroupNode {
  return mapGroups(root, (g) =>
    g.id === parentId
      ? {
          ...g,
          children: [
            ...g.children.slice(0, index),
            node,
            ...g.children.slice(index),
          ],
        }
      : g,
  )
}

export const append = (root: GroupNode, parentId: string, cond: Cond) => {
  const parent = find(root, parentId)
  const at = parent?.kind === "group" ? parent.children.length : 0
  return insertAt(root, parentId, at, { kind: "atom", id: newId(), cond })
}

export function removeNode(root: GroupNode, id: string): GroupNode {
  return prune(
    mapGroups(root, (g) => ({
      ...g,
      children: g.children.filter((c) => c.id !== id),
    })),
  )
}

export function removeWhere(
  root: GroupNode,
  pred: (c: Cond) => boolean,
): GroupNode {
  return prune(
    mapGroups(root, (g) => ({
      ...g,
      children: g.children.filter((c) => c.kind === "group" || !pred(c.cond)),
    })),
  )
}

export function replaceNode(
  root: GroupNode,
  id: string,
  next: FilterNode,
): GroupNode {
  if (root.id === id && next.kind === "group") return next
  return mapGroups(root, (g) => ({
    ...g,
    children: g.children.map((c) => (c.id === id ? next : c)),
  }))
}

export const setOp = (root: GroupNode, groupId: string, op: Joiner) =>
  mapGroups(root, (g) => (g.id === groupId ? { ...g, op } : g))

/**
 * Move `id` to `index` inside `parentId`. Refuses to move a group into
 * itself. `index` is read against the parent as it is before the move.
 */
export function moveNode(
  root: GroupNode,
  id: string,
  parentId: string,
  index: number,
): GroupNode {
  const node = find(root, id)
  if (!node || find(node, parentId)) return root
  const from = parentOf(root, id)
  const shift =
    from && from.parent.id === parentId && from.index < index ? 1 : 0
  const without = mapGroups(root, (g) => ({
    ...g,
    children: g.children.filter((c) => c.id !== id),
  }))
  return prune(insertAt(without, parentId, index - shift, node))
}

/** Put `id` in a new group of its own, at its place: "( a )". */
export function wrap(root: GroupNode, id: string, op: Joiner): GroupNode {
  const node = find(root, id)
  if (!node) return root
  return replaceNode(root, id, {
    kind: "group",
    id: newId(),
    op,
    children: [node],
  })
}

/** Drop `dragId` onto `targetId`: both go in a new group where the target was. */
export function groupWith(
  root: GroupNode,
  dragId: string,
  targetId: string,
): GroupNode {
  if (dragId === targetId) return root
  const drag = find(root, dragId)
  const target = find(root, targetId)
  if (!drag || !target || find(drag, targetId)) return root
  const at = parentOf(root, targetId)
  const op: Joiner = at?.parent.op === "and" ? "or" : "and"
  const removed = mapGroups(root, (g) => ({
    ...g,
    children: g.children.filter((c) => c.id !== dragId),
  }))
  return prune(
    replaceNode(removed, targetId, {
      kind: "group",
      id: newId(),
      op,
      children: [target, drag],
    }),
  )
}

/** Remove a group's parentheses, splicing its children into its parent. */
export function unwrap(root: GroupNode, groupId: string): GroupNode {
  return prune(
    mapGroups(root, (g) => ({
      ...g,
      children: g.children.flatMap((c) =>
        c.id === groupId && c.kind === "group" ? c.children : [c],
      ),
    })),
  )
}

/** Outliner move: into the previous sibling if it is a group, else pair up. */
export function indent(root: GroupNode, id: string): GroupNode {
  const at = parentOf(root, id)
  if (!at || at.index === 0) return root
  const prev = at.parent.children[at.index - 1]
  if (prev.kind === "group")
    return moveNode(root, id, prev.id, prev.children.length)
  return groupWith(root, id, prev.id)
}

/** Outliner move: out of its group, to just after that group. */
export function outdent(root: GroupNode, id: string): GroupNode {
  const at = parentOf(root, id)
  if (!at || at.parent.id === root.id) return root
  const up = parentOf(root, at.parent.id)
  if (!up) return root
  return moveNode(root, id, up.parent.id, up.index + 1)
}

export function nudge(root: GroupNode, id: string, by: -1 | 1): GroupNode {
  const at = parentOf(root, id)
  if (!at) return root
  const to = at.index + by
  if (to < 0 || to >= at.parent.children.length) return root
  return moveNode(root, id, at.parent.id, by === 1 ? to + 1 : to)
}

// ---- Text form, for T3 and for summaries --------------------------------

export type Names = {
  groupName: (id: string) => string
  groupId: (name: string) => string | undefined
  tagLabel: (id: string) => string
  tagId: (label: string) => string
}

const METRIC_ALIASES: Record<string, MetricKey> = {
  subscribers: "subscribers",
  subs: "subscribers",
  reach: "reach",
  activity: "activity_rate",
  activity_rate: "activity_rate",
  posts: "total_posts",
  total_posts: "total_posts",
  scope: "posts_in_scope",
  posts_in_scope: "posts_in_scope",
  updated_days: "days_since_update",
  days_since_update: "days_since_update",
  followed_days: "days_followed",
  days_followed: "days_followed",
  photos: "photos",
  videos: "videos",
  files: "files",
  links: "links",
}

const metricWord = (k: MetricKey) =>
  Object.entries(METRIC_ALIASES).find(([, v]) => v === k)?.[0] ?? k

const quote = (s: string) => (/^[\p{L}\p{N}_.-]+$/u.test(s) ? s : `"${s}"`)

export function condText(c: Cond, names: Names): string {
  switch (c.type) {
    case "tag":
      return `tag:${quote(names.tagLabel(c.value))}`
    case "group":
      return `group:${quote(names.groupName(c.value))}`
    case "language":
      return `lang:${c.value}`
    case "metric": {
      const w = metricWord(c.metric)
      if (c.min !== undefined && c.max !== undefined)
        return `${w} ${c.min}..${c.max}`
      if (c.min !== undefined) return `${w} >= ${c.min}`
      return `${w} <= ${c.max}`
    }
  }
}

/** Short human label for a condition chip. */
export function condLabel(c: Cond, names: Names): string {
  switch (c.type) {
    case "tag":
      return names.tagLabel(c.value)
    case "group":
      return names.groupName(c.value)
    case "language":
      return c.value
    case "metric": {
      const m = metric(c.metric).label
      if (c.min !== undefined && c.max !== undefined)
        return `${m} ${formatNumber(c.min)}–${formatNumber(c.max)}`
      if (c.min !== undefined) return `${m} ≥ ${formatNumber(c.min)}`
      return `${m} ≤ ${formatNumber(c.max ?? 0)}`
    }
  }
}

export function toText(n: FilterNode, names: Names, top = true): string {
  if (n.kind === "atom") return condText(n.cond, names)
  const inner = n.children.map((c) => toText(c, names, false)).join(` ${n.op} `)
  return top || n.children.length < 2 ? inner : `(${inner})`
}

type Tok =
  | { t: "(" | ")" | "and" | "or"; at: number }
  | { t: "atom"; cond: Cond; at: number; len: number }

export type ParseResult =
  | { ok: true; tree: GroupNode }
  | { ok: false; error: string; at: number }

class ParseError extends Error {
  constructor(
    message: string,
    public at: number,
  ) {
    super(message)
  }
}

function tokenize(raw: string, names: Names): Tok[] {
  // "activity rate < 10" reads naturally; keep offsets so errors point right.
  // "tag tech" and "group news" read naturally too: same length as "tag:".
  const src = raw
    .replace(/\b(tag|group|lang)\s+(?=["\p{L}\p{N}_])/giu, (m, k) =>
      `${k}:`.padEnd(m.length),
    )
    .replace(/activity\s+rate/gi, (m) => "activity_rate".padEnd(m.length))
  const out: Tok[] = []
  const word = /^([a-z]+:)?(?:"([^"]*)"|([\p{L}\p{N}_.-]+))/iu
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === "(" || ch === ")") {
      out.push({ t: ch, at: i })
      i++
      continue
    }
    if (ch === "&" || ch === "|") {
      const len = src[i + 1] === ch ? 2 : 1
      out.push({ t: ch === "&" ? "and" : "or", at: i })
      i += len
      continue
    }
    // metric comparison: reach >= 200, subs<100, reach 200..1000
    const cmp = /^([a-z_]+)\s*(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)/i.exec(
      src.slice(i),
    )
    const rng =
      /^([a-z_]+)\s+(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)/i.exec(
        src.slice(i),
      )
    const m = cmp ?? rng
    if (m && METRIC_ALIASES[m[1].toLowerCase()]) {
      const key = METRIC_ALIASES[m[1].toLowerCase()]
      const cond: Cond = rng
        ? { type: "metric", metric: key, min: Number(m[2]), max: Number(m[3]) }
        : m[2].startsWith(">")
          ? { type: "metric", metric: key, min: Number(m[3]) }
          : m[2].startsWith("<")
            ? { type: "metric", metric: key, max: Number(m[3]) }
            : {
                type: "metric",
                metric: key,
                min: Number(m[3]),
                max: Number(m[3]),
              }
      out.push({ t: "atom", cond, at: i, len: m[0].length })
      i += m[0].length
      continue
    }
    const w = word.exec(src.slice(i))
    if (!w) throw new ParseError(`Unexpected “${ch}”`, i)
    const prefix = w[1]?.slice(0, -1).toLowerCase()
    const text = w[2] ?? w[3]
    const lower = text.toLowerCase()
    if (!prefix && w[3] && (lower === "and" || lower === "or")) {
      out.push({ t: lower, at: i })
    } else {
      let cond: Cond
      if (prefix === "group") {
        const id = names.groupId(text)
        if (!id) throw new ParseError(`No group named “${text}”`, i)
        cond = { type: "group", value: id }
      } else if (prefix === "lang") cond = { type: "language", value: text }
      else if (prefix === "tag" || (!prefix && w[2] !== undefined))
        cond = { type: "tag", value: names.tagId(text) }
      else if (prefix) throw new ParseError(`Unknown “${prefix}:”`, i)
      else if (METRIC_ALIASES[lower])
        throw new ParseError(
          `“${text}” needs a comparison, e.g. ${text} >= 100`,
          i,
        )
      else cond = { type: "tag", value: names.tagId(text) } // a bare word is a tag
      out.push({ t: "atom", cond, at: i, len: w[0].length })
    }
    i += w[0].length
  }
  return out
}

/**
 * or-expr  := and-expr ("or" and-expr)*
 * and-expr := primary ("and" primary)*
 * primary  := atom | "(" or-expr ")"
 * AND binds tighter than OR, as in every query language people already know.
 */
export function parse(src: string, names: Names): ParseResult {
  try {
    const toks = tokenize(src, names)
    let i = 0
    const peek = () => toks[i]
    const group = (op: Joiner, children: FilterNode[]): FilterNode =>
      children.length === 1
        ? children[0]
        : { kind: "group", id: newId(), op, children }
    const primary = (): FilterNode => {
      const t = peek()
      if (!t) throw new ParseError("Expression ends too early", src.length)
      if (t.t === "atom") {
        i++
        return { kind: "atom", id: newId(), cond: t.cond }
      }
      if (t.t === "(") {
        i++
        const inner = orExpr()
        const close = peek()
        if (close?.t !== ")")
          throw new ParseError("Missing “)”", close?.at ?? src.length)
        i++
        return inner.kind === "group"
          ? inner
          : { kind: "group", id: newId(), op: "and", children: [inner] }
      }
      throw new ParseError(`Unexpected “${t.t}”`, t.at)
    }
    const andExpr = (): FilterNode => {
      const parts = [primary()]
      while (peek()?.t === "and" || peek()?.t === "atom" || peek()?.t === "(") {
        if (peek()?.t === "and") i++ // two conditions side by side mean AND
        parts.push(primary())
      }
      return group("and", parts)
    }
    const orExpr = (): FilterNode => {
      const parts = [andExpr()]
      while (peek()?.t === "or") {
        i++
        parts.push(andExpr())
      }
      return group("or", parts)
    }
    if (toks.length === 0) return { ok: true, tree: emptyTree() }
    const body = orExpr()
    if (i < toks.length) throw new ParseError("Unexpected “)”", toks[i].at)
    const tree: GroupNode =
      body.kind === "group"
        ? { ...body, id: "root" }
        : { kind: "group", id: "root", op: "and", children: [body] }
    return { ok: true, tree }
  } catch (e) {
    if (e instanceof ParseError)
      return { ok: false, error: e.message, at: e.at }
    throw e
  }
}

export const METRIC_WORDS = METRICS.map((m) => ({
  word: metricWord(m.key),
  label: m.label,
}))

/** Make the tree's `type` values exactly `next`: drop the rest, append the new. */
export function syncValues(
  root: GroupNode,
  type: "tag" | "group" | "language",
  next: string[],
): GroupNode {
  const have = new Set(
    atoms(root).flatMap((a) => (a.cond.type === type ? [a.cond.value] : [])),
  )
  let t = removeWhere(root, (c) => c.type === type && !next.includes(c.value))
  for (const v of next)
    if (!have.has(v)) t = append(t, "root", { type, value: v })
  return t
}

export const valuesOf = (
  root: GroupNode,
  type: "tag" | "group" | "language",
) => [
  ...new Set(
    atoms(root).flatMap((a) => (a.cond.type === type ? [a.cond.value] : [])),
  ),
]

export function makeNames(
  groups: readonly { id: string; name: string }[],
  pseudo: readonly { id: string; label: string }[],
): Names {
  return {
    groupName: (id) => groups.find((g) => g.id === id)?.name ?? id,
    groupId: (name) =>
      groups.find((g) => g.name.toLowerCase() === name.toLowerCase())?.id,
    tagLabel: (id) => pseudo.find((c) => c.id === id)?.label ?? id,
    tagId: (label) =>
      pseudo.find((c) => c.label.toLowerCase() === label.toLowerCase())?.id ??
      label,
  }
}
