import { describe, expect, test } from "bun:test"
import type { FilterNode } from "@/lib/filter-tree"
import {
  addPostFunnel,
  emptyPostFilter,
  type PostCond,
  type PostFilter,
  parsePostFilter,
  postConditionLabel,
  postFilterBody,
  printPostFilter,
} from "./post-filter"

let n = 0
const atom = (cond: PostCond, not = false): FilterNode<PostCond> => ({
  kind: "atom",
  id: `a${++n}`,
  cond,
  ...(not ? { not } : {}),
})
const grp = (
  op: "and" | "or",
  children: FilterNode<PostCond>[],
  not = false,
): FilterNode<PostCond> => ({
  kind: "group",
  id: `g${++n}`,
  op,
  children,
  ...(not ? { not } : {}),
})
const root = (
  op: "and" | "or",
  children: FilterNode<PostCond>[],
  not = false,
): PostFilter => ({ ...(grp(op, children, not) as PostFilter), id: "root" })

const fa: PostCond = { type: "language", value: "fa" }
const en: PostCond = { type: "language", value: "en" }
const video: PostCond = { type: "media", value: "video" }
const forwarded: PostCond = { type: "type", value: "forwarded" }

/** The tree without its ids, which a parse mints afresh. */
function shape(node: FilterNode<PostCond>): unknown {
  if (node.kind === "atom") return { cond: node.cond, not: !!node.not }
  return {
    op: node.op,
    not: !!node.not,
    children: node.children.map(shape),
  }
}

describe("the Post filter's labels", () => {
  test.each<[PostCond, string]>([
    [
      { type: "type", value: "unfollowed_forwarded" },
      "Forwarded from unfollowed channels",
    ],
    [{ type: "type", value: "original" }, "Original"],
    [{ type: "media", value: "link_preview" }, "Links"],
    [{ type: "language", value: "zxx" }, "No text"],
    [{ type: "channel", value: "durov" }, "@durov"],
    [{ type: "views", measure: "views", min: 10_000 }, "Views ≥ 10K"],
    [
      { type: "views", measure: "estimated", max: 500 },
      "Estimated views ≤ 500",
    ],
    [
      { type: "views", measure: "views", min: 1_000, max: 5_000 },
      "Views 1K–5K",
    ],
    [
      { type: "views", measure: "estimated", none: true },
      "Estimated views: no value",
    ],
  ])("%o reads %s", (cond, label) => {
    expect(postConditionLabel(cond)).toBe(label)
  })
})

describe("the URL form", () => {
  const roundTrip = (filter: PostFilter) => {
    const text = printPostFilter(filter)
    const parsed = parsePostFilter(text)
    expect(parsed ? shape(parsed) : parsed).toEqual(shape(filter))
    return text
  }

  test("prints readable text", () => {
    expect(
      printPostFilter(
        root("or", [
          grp("and", [atom(fa), atom(video)]),
          atom({ type: "views", measure: "views", min: 10_000 }),
        ]),
      ),
    ).toBe("(lang:fa and media:video) or views >= 10000")
  })

  test("printing then parsing gives back the same tree", () => {
    roundTrip(emptyPostFilter())
    roundTrip(root("and", [atom(fa, true)]))
    roundTrip(root("or", [atom(fa), atom(en)]))
    roundTrip(root("and", [atom(forwarded), atom(video, true)]))
    roundTrip(root("and", [atom(fa), atom(video)], true))
    roundTrip(root("and", [atom({ type: "channel", value: "some channel" })]))
  })

  test("a NOT inside parentheses survives", () => {
    const text = roundTrip(
      root("or", [
        grp("and", [atom(fa, true), atom(video)]),
        grp("or", [atom(forwarded), atom(en)], true),
      ]),
    )
    expect(text).toBe(
      "(not lang:fa and media:video) or not (type:forwarded or lang:en)",
    )
  })

  test("a root holding one negated group reads back as that group", () => {
    roundTrip(root("and", [grp("or", [atom(fa), atom(en)], true)]))
  })

  test.each<PostCond>([
    { type: "views", measure: "views", min: 200 },
    { type: "views", measure: "estimated", max: 50 },
    { type: "views", measure: "views", min: 1.5, max: 2_000 },
    { type: "views", measure: "estimated", none: true },
  ])("every bound round-trips: %o", (cond) => {
    roundTrip(root("and", [atom(cond)]))
    roundTrip(root("and", [atom(cond, true)]))
  })

  test.each([
    "(lang:fa",
    "lang:fa)",
    "media:hologram",
    "type:all",
    "reach >= 10",
    "tag:news",
    "fa",
    "and",
    "views >= -1",
  ])("%s is ignored", (text) => {
    expect(parsePostFilter(text)).toBeNull()
  })

  test("blank text is the empty filter", () => {
    expect(parsePostFilter("  ")).toEqual(emptyPostFilter())
  })
})

describe("funnels and the wire", () => {
  test("two funnels in one dropdown join with OR, two dropdowns with AND", () => {
    let filter = addPostFunnel(emptyPostFilter(), "language", "fa")
    filter = addPostFunnel(filter, "language", "en")
    filter = addPostFunnel(filter, "media", "video")
    expect(printPostFilter(filter)).toBe("(lang:fa or lang:en) and media:video")
  })

  test("an empty filter sends nothing, a negated empty one too", () => {
    expect(postFilterBody(emptyPostFilter())).toBeUndefined()
    expect(postFilterBody({ ...emptyPostFilter(), not: true })).toBeUndefined()
    const filter = root("and", [atom(fa, true)])
    expect(postFilterBody(filter)).toBe(filter)
  })
})
