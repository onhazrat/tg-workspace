/**
 * The Directory Tags dropdown's funnel (TGU-03), as `addFunnel` is on the
 * Channels tab but for the Directory's `tag:` Condition, which holds a name:
 * one funnelled Tag is a Condition on the top-level AND, two or more one OR
 * group there. A Tag anywhere else is the Filters' own and not a funnel.
 */
import {
  andRoot,
  append,
  type FilterNode,
  type GroupNode,
  newId,
  removeNode,
  replaceNode,
} from "@/lib/filter-tree"
import type { DirectoryCond, DirectoryFilter } from "./directory-filter"
import { sameTag } from "./directory-tags"

type Node = FilterNode<DirectoryCond>
type TagAtom = Node & { kind: "atom"; cond: { type: "tag"; name: string } }

const isTagAtom = (n: Node): n is TagAtom =>
  n.kind === "atom" && !n.not && n.cond.type === "tag"
const isTagOr = (n: Node): n is GroupNode<DirectoryCond> =>
  n.kind === "group" &&
  !n.not &&
  n.op === "or" &&
  n.children.length > 0 &&
  n.children.every(isTagAtom)
const isAndRoot = (f: DirectoryFilter) =>
  !f.not && (f.op === "and" || f.children.length <= 1)

/** The funnel's Conditions: top-level Tags and a top-level OR of Tags. */
function funnelAtoms(filter: DirectoryFilter): TagAtom[] {
  if (!isAndRoot(filter)) return []
  return filter.children.flatMap((c) =>
    isTagAtom(c) ? [c] : isTagOr(c) ? c.children.filter(isTagAtom) : [],
  )
}

export const funnelledTags = (filter: DirectoryFilter): string[] =>
  funnelAtoms(filter).map((a) => a.cond.name)

const without = (filter: DirectoryFilter, drop: TagAtom[]) =>
  drop.reduce((f, atom) => removeNode(f, atom.id), filter)

export const clearTagFunnels = (filter: DirectoryFilter) =>
  without(filter, funnelAtoms(filter))

export function toggleTagFunnel(
  filter: DirectoryFilter,
  name: string,
  on: boolean,
): DirectoryFilter {
  const same = funnelAtoms(filter).filter((a) => sameTag(a.cond.name, name))
  if (!on) return without(filter, same)
  if (same.length > 0) return filter
  const cond: DirectoryCond = { type: "tag", name }
  const base = andRoot(filter)
  const or = base.children.find(isTagOr)
  if (or) return append(base, or.id, cond)
  const lone = base.children.find(isTagAtom)
  if (!lone) return append(base, "root", cond)
  return replaceNode(base, lone.id, {
    kind: "group",
    id: newId(),
    op: "or",
    children: [lone, { kind: "atom", id: newId(), cond }],
  })
}
