/**
 * The Directory Tags and Groups dropdowns' funnel (TGU-03, TGU-04), as
 * `addFunnel` is on the Channels tab but for the Directory's `tag:` and
 * `group:` Conditions, which hold a name: one funnelled Tag is a Condition on
 * the top-level AND, two or more one OR group there; Setting groups get their
 * own. A Tag anywhere else is the Filters' own and not a funnel.
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

/** What a funnel holds: a Tag, or a Setting group (TGU-04). */
type Funnel = "tag" | "group"
type Node = FilterNode<DirectoryCond>
type NamedAtom = Node & {
  kind: "atom"
  cond: { type: Funnel; name: string }
}

const isAtom =
  (type: Funnel) =>
  (n: Node): n is NamedAtom =>
    n.kind === "atom" && !n.not && n.cond.type === type
const isOr =
  (type: Funnel) =>
  (n: Node): n is GroupNode<DirectoryCond> =>
    n.kind === "group" &&
    !n.not &&
    n.op === "or" &&
    n.children.length > 0 &&
    n.children.every(isAtom(type))
const isAndRoot = (f: DirectoryFilter) =>
  !f.not && (f.op === "and" || f.children.length <= 1)

/** The funnel's Conditions: top-level ones of `type` and a top-level OR of them. */
function funnelAtoms(filter: DirectoryFilter, type: Funnel): NamedAtom[] {
  if (!isAndRoot(filter)) return []
  return filter.children.flatMap((c) =>
    isAtom(type)(c)
      ? [c]
      : isOr(type)(c)
        ? c.children.filter(isAtom(type))
        : [],
  )
}

export const funnelledTags = (
  filter: DirectoryFilter,
  type: Funnel = "tag",
): string[] => funnelAtoms(filter, type).map((a) => a.cond.name)

const without = (filter: DirectoryFilter, drop: NamedAtom[]) =>
  drop.reduce((f, atom) => removeNode(f, atom.id), filter)

export const clearTagFunnels = (
  filter: DirectoryFilter,
  type: Funnel = "tag",
) => without(filter, funnelAtoms(filter, type))

export function toggleTagFunnel(
  filter: DirectoryFilter,
  name: string,
  on: boolean,
  type: Funnel = "tag",
): DirectoryFilter {
  const same = funnelAtoms(filter, type).filter((a) =>
    sameTag(a.cond.name, name),
  )
  if (!on) return without(filter, same)
  if (same.length > 0) return filter
  const cond: DirectoryCond = { type, name }
  const base = andRoot(filter)
  const or = base.children.find(isOr(type))
  if (or) return append(base, or.id, cond)
  const lone = base.children.find(isAtom(type))
  if (!lone) return append(base, "root", cond)
  return replaceNode(base, lone.id, {
    kind: "group",
    id: newId(),
    op: "or",
    children: [lone, { kind: "atom", id: newId(), cond }],
  })
}
