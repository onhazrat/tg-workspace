/**
 * PROTOTYPE, throwaway: filters as a nested expression, for T1. The text
 * form and parser (T3) and the outline moves (T2) live in e4d5002. A group
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

/** `not` flips the node's answer: "not tag:x", "not (a or b)". */
export type AtomNode = { kind: "atom"; id: string; cond: Cond; not?: boolean }
export type GroupNode = {
  kind: "group"
  id: string
  not?: boolean
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

/**
 * An empty group passes everything, negated or not, so an empty tree (or a
 * lone "not ()") filters nothing rather than hiding every channel.
 */
export function evalNode(
  n: FilterNode,
  c: Channel,
  inputs: MetricInputs,
): boolean {
  if (n.kind === "group" && n.children.length === 0) return true
  const r =
    n.kind === "atom"
      ? testCond(n.cond, c, inputs)
      : n.op === "and"
        ? n.children.every((ch) => evalNode(ch, c, inputs))
        : n.children.some((ch) => evalNode(ch, c, inputs))
  return n.not ? !r : r
}

/** Flip one node's `not`. The root may be negated too: "not (a and b)". */
export function toggleNot(root: GroupNode, id: string): GroupNode {
  if (root.id === id) return { ...root, not: !root.not }
  return mapGroups(root, (g) => ({
    ...g,
    children: g.children.map((c) => (c.id === id ? { ...c, not: !c.not } : c)),
  }))
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
        // "not (a)" collapses to "not a"; "not (not a)" to "a".
        c.kind === "group" && c.children.length === 1
          ? { ...c.children[0], not: !!c.children[0].not !== !!c.not }
          : c,
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

/**
 * Remove a group's parentheses, splicing its children into its parent. The
 * editors only offer this on a group without `not`, since dropping the
 * parentheses of "not (a or b)" would silently change what it means.
 */
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

// ---- Labels ---------------------------------------------------------------

export type Names = {
  groupName: (id: string) => string
  tagLabel: (id: string) => string
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
    tagLabel: (id) => pseudo.find((c) => c.id === id)?.label ?? id,
  }
}
