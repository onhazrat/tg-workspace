// PROTOTYPE (channel-tags-usage): the Directory Tags dropdown's funnel. Never
// merge. Funnels join with OR, as on the Channels tab: one Tag is a top-level
// `tag:` Condition, two or more an OR group of them on the top-level AND.
import type {
  DirectoryCond,
  DirectoryFilter,
} from "@/lib/directory/directory-filter"
import { sameTag } from "@/lib/directory/directory-tags"
import { emptyTree, type FilterNode, newId } from "@/lib/filter-tree"

type Node = FilterNode<DirectoryCond>
const isTagAtom = (n: Node) =>
  n.kind === "atom" && !n.not && n.cond.type === "tag"
const isTagOr = (n: Node) =>
  n.kind === "group" &&
  !n.not &&
  n.op === "or" &&
  n.children.length > 0 &&
  n.children.every(isTagAtom)
const tagName = (n: Node) =>
  n.kind === "atom" && n.cond.type === "tag" ? [n.cond.name] : []

/** The funnelled Tags; ones inside other parentheses are the Filters' own. */
export function funnelledTags(filter: DirectoryFilter): string[] {
  const root =
    !filter.not && (filter.op === "and" || filter.children.length <= 1)
  if (!root) return []
  return filter.children.flatMap((c) =>
    isTagAtom(c)
      ? tagName(c)
      : isTagOr(c) && c.kind === "group"
        ? c.children.flatMap(tagName)
        : [],
  )
}

export function setTagFunnels(
  filter: DirectoryFilter,
  names: string[],
): DirectoryFilter {
  const rootIsAnd =
    !filter.not && (filter.op === "and" || filter.children.length <= 1)
  const base: DirectoryFilter = rootIsAnd
    ? { ...filter, op: "and" }
    : { ...emptyTree<DirectoryCond>(), children: [{ ...filter, id: newId() }] }
  // ponytail: two ANDed top-level Tags become one OR group once a funnel is touched.
  const rest = base.children.filter((c) => !isTagAtom(c) && !isTagOr(c))
  const atom = (name: string): Node => ({
    kind: "atom",
    id: newId(),
    cond: { type: "tag", name },
  })
  const funnel: Node[] =
    names.length === 0
      ? []
      : names.length === 1
        ? [atom(names[0])]
        : [{ kind: "group", id: newId(), op: "or", children: names.map(atom) }]
  return { ...base, children: [...rest, ...funnel] }
}

export function toggleTagFunnel(
  filter: DirectoryFilter,
  name: string,
  on: boolean,
): DirectoryFilter {
  const now = funnelledTags(filter).filter((n) => !sameTag(n, name))
  return setTagFunnels(filter, on ? [...now, name] : now)
}
