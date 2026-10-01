/**
 * A filter as a tree of Conditions (CTB-01, CTB-03), shared by the Channels
 * and Posts tabs. Parentheses are just groups:
 *   (tag tech and lang fa) or (tag news and not group slow)
 * is OR[ AND[tech, fa], AND[news, NOT slow] ]. Any node can be negated, and
 * an empty group passes everything, negated or not, so an empty filter hides
 * nothing.
 *
 * The tree knows nothing about what a Condition tests: each tab supplies its
 * own Condition type and the test `evalTree` calls.
 */

/** Every Condition names its kind; a funnelled one also holds a value. */
export type BaseCond = { type: string }
type WithValue<C> = C extends { value: string } ? C : never

export type Joiner = "and" | "or"

export type AtomNode<C extends BaseCond> = {
  kind: "atom"
  id: string
  cond: C
  not?: boolean
}
export type GroupNode<C extends BaseCond> = {
  kind: "group"
  id: string
  op: Joiner
  not?: boolean
  children: FilterNode<C>[]
}
export type FilterNode<C extends BaseCond> = AtomNode<C> | GroupNode<C>
/** The root is always a group, with the id `root`. */
export type FilterTree<C extends BaseCond> = GroupNode<C>

export const flip = (op: Joiner): Joiner => (op === "and" ? "or" : "and")

let seq = 0
export const newId = () => `n${++seq}`

export const emptyTree = <C extends BaseCond>(): FilterTree<C> => ({
  kind: "group",
  id: "root",
  op: "and",
  children: [],
})

// ---- Evaluation ------------------------------------------------------------

/** Whether `test` passes the tree; an empty group passes. */
export function evalTree<C extends BaseCond>(
  node: FilterNode<C>,
  test: (cond: C) => boolean,
): boolean {
  if (node.kind === "group" && node.children.length === 0) return true
  const result =
    node.kind === "atom"
      ? test(node.cond)
      : node.op === "and"
        ? node.children.every((child) => evalTree(child, test))
        : node.children.some((child) => evalTree(child, test))
  return node.not ? !result : result
}

// ---- Reading the tree ------------------------------------------------------

export function atoms<C extends BaseCond>(node: FilterNode<C>): AtomNode<C>[] {
  return node.kind === "atom" ? [node] : node.children.flatMap(atoms)
}

function find<C extends BaseCond>(
  node: FilterNode<C>,
  id: string,
): FilterNode<C> | null {
  if (node.id === id) return node
  if (node.kind === "atom") return null
  for (const child of node.children) {
    const hit = find(child, id)
    if (hit) return hit
  }
  return null
}

function parentOf<C extends BaseCond>(
  root: GroupNode<C>,
  id: string,
): { parent: GroupNode<C>; index: number } | null {
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
export function mapGroups<C extends BaseCond>(
  group: GroupNode<C>,
  fn: (group: GroupNode<C>) => GroupNode<C>,
): GroupNode<C> {
  return fn({
    ...group,
    children: group.children.map((child) =>
      child.kind === "group" ? mapGroups(child, fn) : child,
    ),
  })
}

const withoutNode = <C extends BaseCond>(root: FilterTree<C>, id: string) =>
  mapGroups(root, (group) => ({
    ...group,
    children: group.children.filter((child) => child.id !== id),
  }))

function childCounts<C extends BaseCond>(
  node: FilterNode<C>,
  into = new Map<string, number>(),
) {
  if (node.kind === "group") {
    into.set(node.id, node.children.length)
    for (const child of node.children) childCounts(child, into)
  }
  return into
}

/**
 * Drop empty groups and unwrap the groups an edit of `before` left holding
 * one block, so a remove or a move never leaves "()" or "(a)" behind. A
 * chip the Account put in parentheses by itself keeps them. Unwrapping keeps
 * the negation: "not (a)" is "not a", and "not (not a)" is "a". The root
 * stays a group.
 */
function prune<C extends BaseCond>(
  root: FilterTree<C>,
  before: FilterTree<C>,
): FilterTree<C> {
  const had = childCounts(before)
  return mapGroups(root, (group) => ({
    ...group,
    children: group.children
      .filter((child) => child.kind === "atom" || child.children.length > 0)
      .map((child) =>
        child.kind === "group" &&
        child.children.length === 1 &&
        (had.get(child.id) ?? 0) > 1
          ? {
              ...child.children[0],
              not: !!child.children[0].not !== !!child.not,
            }
          : child,
      ),
  }))
}

function insertAt<C extends BaseCond>(
  root: FilterTree<C>,
  parentId: string,
  index: number,
  node: FilterNode<C>,
): FilterTree<C> {
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

export function append<C extends BaseCond>(
  root: FilterTree<C>,
  parentId: string,
  cond: C,
): FilterTree<C> {
  const parent = find(root, parentId)
  const at = parent?.kind === "group" ? parent.children.length : 0
  return insertAt(root, parentId, at, { kind: "atom", id: newId(), cond })
}

export const removeNode = <C extends BaseCond>(
  root: FilterTree<C>,
  id: string,
): FilterTree<C> => prune(withoutNode(root, id), root)

export function replaceNode<C extends BaseCond>(
  root: FilterTree<C>,
  id: string,
  next: FilterNode<C>,
): FilterTree<C> {
  if (root.id === id && next.kind === "group") return { ...next, id: "root" }
  return mapGroups(root, (group) => ({
    ...group,
    children: group.children.map((child) => (child.id === id ? next : child)),
  }))
}

/** Give Condition `id` a new Condition, keeping its NOT. */
export function replaceCond<C extends BaseCond>(
  root: FilterTree<C>,
  id: string,
  cond: C,
): FilterTree<C> {
  const node = find(root, id)
  return node?.kind === "atom" ? replaceNode(root, id, { ...node, cond }) : root
}

export const setOp = <C extends BaseCond>(
  root: FilterTree<C>,
  groupId: string,
  op: Joiner,
): FilterTree<C> =>
  mapGroups(root, (group) => (group.id === groupId ? { ...group, op } : group))

/** Flip one node's NOT; the root may be negated too. */
export function toggleNot<C extends BaseCond>(
  root: FilterTree<C>,
  id: string,
): FilterTree<C> {
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
export function moveNode<C extends BaseCond>(
  root: FilterTree<C>,
  id: string,
  parentId: string,
  index: number,
): FilterTree<C> {
  const node = find(root, id)
  if (!node || find(node, parentId)) return root
  const from = parentOf(root, id)
  const shift =
    from && from.parent.id === parentId && from.index < index ? 1 : 0
  return prune(
    insertAt(withoutNode(root, id), parentId, index - shift, node),
    root,
  )
}

/** Put `id` in parentheses of its own, where it was. */
export function wrap<C extends BaseCond>(
  root: FilterTree<C>,
  id: string,
  op: Joiner,
): FilterTree<C> {
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
 * groups. Neither may hold the other.
 */
export function groupWith<C extends BaseCond>(
  root: FilterTree<C>,
  dragId: string,
  targetId: string,
): FilterTree<C> {
  if (dragId === targetId) return root
  const drag = find(root, dragId)
  const target = find(root, targetId)
  if (!drag || !target || find(drag, targetId) || find(target, dragId))
    return root
  const op = flip(parentOf(root, targetId)?.parent.op ?? "or")
  return prune(
    replaceNode(withoutNode(root, dragId), targetId, {
      kind: "group",
      id: newId(),
      op,
      children: [target, drag],
    }),
    root,
  )
}

/**
 * Remove a group's parentheses, splicing its children into its parent. The
 * editor never offers it on a negated group, since dropping the parentheses
 * of "not (a or b)" would change what it means.
 */
export function unwrap<C extends BaseCond>(
  root: FilterTree<C>,
  groupId: string,
): FilterTree<C> {
  return prune(
    mapGroups(root, (group) => ({
      ...group,
      children: group.children.flatMap((child) =>
        child.id === groupId && child.kind === "group"
          ? child.children
          : [child],
      ),
    })),
    root,
  )
}

// ---- Funnels ---------------------------------------------------------------

const hasValue = <C extends BaseCond>(cond: C): cond is WithValue<C> =>
  typeof (cond as { value?: unknown }).value === "string"

/** The values of `type` that appear in a Condition anywhere in the tree. */
export const funnelledValues = <C extends BaseCond>(
  filter: FilterTree<C>,
  type: WithValue<C>["type"],
): string[] => [
  ...new Set(
    atoms(filter).flatMap((a) =>
      a.cond.type === type && hasValue(a.cond) ? [a.cond.value] : [],
    ),
  ),
]

const isFunnelOr = <C extends BaseCond>(node: FilterNode<C>, type: string) =>
  node.kind === "group" &&
  !node.not &&
  node.op === "or" &&
  node.children.length > 0 &&
  node.children.every(
    (child) => child.kind === "atom" && !child.not && child.cond.type === type,
  )

/** The filter as a plain AND root, wrapping it when it is an OR or negated. */
function andRoot<C extends BaseCond>(filter: FilterTree<C>): FilterTree<C> {
  if (filter.children.length === 0) return emptyTree()
  if (!filter.not && (filter.op === "and" || filter.children.length === 1)) {
    return { ...filter, op: "and" }
  }
  return { ...emptyTree<C>(), children: [{ ...filter, id: newId() }] }
}

/**
 * A dropdown funnel. Funnels in one dropdown join with OR and different
 * dropdowns with AND: the first of a type appends to the root, the second
 * puts the root-level one and itself in an OR group, later ones join it.
 */
export function addFunnel<C extends BaseCond>(
  filter: FilterTree<C>,
  cond: C & { value: string },
): FilterTree<C> {
  if (funnelledValues(filter, cond.type).includes(cond.value)) return filter
  if (isFunnelOr(filter, cond.type)) return append(filter, "root", cond)
  const base = andRoot(filter)
  const or = base.children.find((child) => isFunnelOr(child, cond.type))
  if (or) return append(base, or.id, cond)
  const lone = base.children.find(
    (child) =>
      child.kind === "atom" && !child.not && child.cond.type === cond.type,
  )
  if (!lone) return append(base, "root", cond)
  return replaceNode(base, lone.id, {
    kind: "group",
    id: newId(),
    op: "or",
    children: [lone, { kind: "atom", id: newId(), cond }],
  })
}

function removeWhere<C extends BaseCond>(
  filter: FilterTree<C>,
  drop: (cond: C) => boolean,
): FilterTree<C> {
  return prune(
    mapGroups(filter, (group) => ({
      ...group,
      children: group.children.filter(
        (child) => child.kind === "group" || !drop(child.cond),
      ),
    })),
    filter,
  )
}

/** Unfunnelling removes every Condition with that value. */
export const removeFunnel = <C extends BaseCond>(
  filter: FilterTree<C>,
  type: WithValue<C>["type"],
  value: string,
): FilterTree<C> =>
  removeWhere(
    filter,
    (cond) => cond.type === type && hasValue(cond) && cond.value === value,
  )

export const clearFunnels = <C extends BaseCond>(
  filter: FilterTree<C>,
  type: WithValue<C>["type"],
): FilterTree<C> => removeWhere(filter, (cond) => cond.type === type)
