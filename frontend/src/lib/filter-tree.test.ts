import { describe, expect, test } from "bun:test"
import {
  addFunnel,
  append,
  atoms,
  clearFunnels,
  emptyTree,
  evalTree,
  type FilterNode,
  type FilterTree,
  funnelledValues,
  groupWith,
  moveNode,
  removeFunnel,
  removeNode,
  replaceCond,
  setOp,
  toggleNot,
  unwrap,
  wrap,
} from "./filter-tree"

// A toy vocabulary, so the tree is tested without any tab's Conditions: a
// colour or a shape is funnelled, a size is a bound with no value.
type Toy =
  | { type: "colour"; value: string }
  | { type: "shape"; value: string }
  | { type: "size"; min: number }
type Thing = { colour: string; shape: string; size: number }

const colour = (value: string): Toy => ({ type: "colour", value })
const shape = (value: string): Toy => ({ type: "shape", value })
const size = (min: number): Toy => ({ type: "size", min })

const test_ = (thing: Thing) => (cond: Toy) =>
  cond.type === "size"
    ? thing.size >= cond.min
    : thing[cond.type] === cond.value
const passes = (tree: FilterNode<Toy>, thing: Thing) =>
  evalTree(tree, test_(thing))

let seq = 0
const atom = (cond: Toy, not?: boolean): FilterNode<Toy> => ({
  kind: "atom",
  id: `a${++seq}`,
  cond,
  ...(not ? { not } : {}),
})
const grp = (
  op: "and" | "or",
  children: FilterNode<Toy>[],
  not?: boolean,
): FilterNode<Toy> & { kind: "group" } => ({
  kind: "group",
  id: `g${++seq}`,
  op,
  children,
  ...(not ? { not } : {}),
})
const root = (
  op: "and" | "or",
  children: FilterNode<Toy>[],
  not?: boolean,
): FilterTree<Toy> => ({ ...grp(op, children, not), id: "root" })

/** The tree with ids dropped, so shapes compare. */
const shapeOf = (node: FilterNode<Toy>): unknown =>
  node.kind === "atom"
    ? { cond: node.cond, ...(node.not ? { not: true } : {}) }
    : {
        op: node.op,
        ...(node.not ? { not: true } : {}),
        children: node.children.map(shapeOf),
      }

const red = { colour: "red", shape: "square", size: 5 }
const blue = { colour: "blue", shape: "round", size: 1 }

describe("evaluation", () => {
  test("an empty group passes, negated or not, at the root and nested", () => {
    expect(passes(emptyTree(), red)).toBe(true)
    expect(passes(root("and", [], true), red)).toBe(true)
    expect(passes(root("and", [grp("or", [], true)]), red)).toBe(true)
  })

  test("AND needs every child, OR any, NOT flips", () => {
    const and = root("and", [atom(colour("red")), atom(size(3))])
    expect(passes(and, red)).toBe(true)
    expect(passes(and, blue)).toBe(false)
    const or = root("or", [atom(colour("blue")), atom(size(3))])
    expect(passes(or, red)).toBe(true)
    expect(passes(or, { ...blue, colour: "green" })).toBe(false)
    expect(passes(root("and", [atom(colour("red"), true)]), red)).toBe(false)
    expect(passes({ ...or, not: true }, red)).toBe(false)
  })

  test("the test a tab supplies decides every atom", () => {
    const seen: Toy[] = []
    evalTree(root("or", [atom(colour("x")), atom(shape("y"))]), (cond) => {
      seen.push(cond)
      return false
    })
    expect(seen).toEqual([colour("x"), shape("y")])
  })
})

describe("editing", () => {
  test("remove prunes empty groups and one-child groups it leaves behind", () => {
    const a = atom(colour("a"))
    const b = atom(colour("b"))
    const c = atom(colour("c"))
    const tree = root("or", [grp("and", [a, b]), grp("and", [c])])
    // (a and b) or (c) → remove b → a or (c): the hand-made "(c)" keeps its
    // parentheses, the "(a)" the remove made does not.
    expect(shapeOf(removeNode(tree, b.id))).toEqual(
      shapeOf(root("or", [a, grp("and", [c])])),
    )
    const lone = root("and", [grp("or", [a])])
    expect(removeNode(lone, a.id).children).toEqual([])
  })

  test("unwrapping keeps NOT: not (a) is not a, not (not a) is a", () => {
    const a = atom(colour("a"))
    const na = atom(colour("a"), true)
    const b = atom(colour("b"))
    expect(
      shapeOf(removeNode(root("and", [grp("or", [a, b], true)]), b.id)),
    ).toEqual(shapeOf(root("and", [atom(colour("a"), true)])))
    expect(
      shapeOf(removeNode(root("and", [grp("or", [na, b], true)]), b.id)),
    ).toEqual(shapeOf(root("and", [atom(colour("a"))])))
  })

  test("append, replaceCond keeps NOT, setOp, toggleNot on the root", () => {
    const appended = append(emptyTree<Toy>(), "root", colour("a"))
    expect(atoms(appended).map((a) => a.cond)).toEqual([colour("a")])
    const negated = { ...appended.children[0], not: true }
    const tree = { ...appended, children: [negated] }
    const swapped = replaceCond(tree, negated.id, shape("s"))
    expect(swapped.children[0]).toMatchObject({ cond: shape("s"), not: true })
    expect(setOp(tree, "root", "or").op).toBe("or")
    expect(toggleNot(tree, "root").not).toBe(true)
    expect(toggleNot(toggleNot(tree, "root"), "root").not).toBe(false)
  })

  test("move never puts a group into itself, and prunes its old place", () => {
    const a = atom(colour("a"))
    const b = atom(colour("b"))
    const c = atom(colour("c"))
    const g = grp("or", [a, b])
    const inner = grp("and", [c])
    const outer = grp("and", [inner, atom(colour("d"))])
    const tree = root("and", [g, outer])
    expect(moveNode(tree, outer.id, inner.id, 0)).toBe(tree)
    expect(moveNode(tree, outer.id, outer.id, 0)).toBe(tree)
    // Moving b out of (a or b) leaves a alone, so its group goes.
    expect(shapeOf(moveNode(tree, b.id, "root", 2))).toEqual(
      shapeOf(root("and", [a, outer, b])),
    )
  })

  test("wrap, groupWith with the opposite operator, unwrap", () => {
    const a = atom(colour("a"))
    const b = atom(colour("b"))
    const tree = root("and", [a, b])
    expect(shapeOf(wrap(tree, a.id, "or"))).toEqual(
      shapeOf(root("and", [grp("or", [a]), b])),
    )
    expect(wrap(tree, "root", "or")).toBe(tree)
    const grouped = groupWith(tree, b.id, a.id)
    expect(shapeOf(grouped)).toEqual(shapeOf(root("and", [grp("or", [a, b])])))
    const g = grouped.children[0]
    expect(groupWith(grouped, g.id, a.id)).toBe(grouped)
    expect(shapeOf(unwrap(grouped, g.id))).toEqual(shapeOf(tree))
  })
})

describe("funnels", () => {
  test("one kind ORs, different kinds AND, a repeat is ignored", () => {
    let tree = addFunnel(emptyTree<Toy>(), { type: "colour", value: "red" })
    tree = addFunnel(tree, { type: "colour", value: "blue" })
    tree = addFunnel(tree, { type: "shape", value: "round" })
    tree = addFunnel(tree, { type: "colour", value: "green" })
    expect(addFunnel(tree, { type: "colour", value: "red" })).toBe(tree)
    expect(shapeOf(tree)).toEqual(
      shapeOf(
        root("and", [
          grp("or", [
            atom(colour("red")),
            atom(colour("blue")),
            atom(colour("green")),
          ]),
          atom(shape("round")),
        ]),
      ),
    )
    expect(funnelledValues(tree, "colour")).toEqual(["red", "blue", "green"])
  })

  test("a funnel on an OR or negated root wraps it under a new AND", () => {
    const or = root("or", [atom(size(2)), atom(shape("x"))])
    expect(shapeOf(addFunnel(or, { type: "colour", value: "red" }))).toEqual(
      shapeOf(root("and", [{ ...or, id: "g" }, atom(colour("red"))])),
    )
  })

  test("remove takes every Condition with that value; clear takes the kind", () => {
    const tree = root("and", [
      grp("or", [atom(colour("red")), atom(colour("blue"))]),
      atom(colour("red"), true),
      atom(size(3)),
    ])
    expect(shapeOf(removeFunnel(tree, "colour", "red"))).toEqual(
      shapeOf(root("and", [atom(colour("blue")), atom(size(3))])),
    )
    expect(shapeOf(clearFunnels(tree, "colour"))).toEqual(
      shapeOf(root("and", [atom(size(3))])),
    )
    // A bound has no value, so it is never a funnel.
    expect(funnelledValues(tree, "size")).toStrictEqual([])
  })
})
