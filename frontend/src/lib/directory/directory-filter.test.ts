/**
 * The Directory filter's text form (DIR-02): what `?dirFilter=` holds. Every
 * Condition prints and parses back unchanged, a bare word reads as Name
 * contains, and anything the server would refuse (an unknown `is:`, a
 * malformed window, a tree past the bounds) does not parse.
 */
import { describe, expect, test } from "bun:test"
import type { FilterNode } from "@/lib/filter-tree"
import {
  type DirectoryCond,
  directoryConditionLabel,
  OPENING_FILTER,
  parseDirectoryFilter,
  printDirectoryFilter,
} from "./directory-filter"

const roundTrip = (text: string) => {
  const filter = parseDirectoryFilter(text)
  expect(filter).not.toBeNull()
  return printDirectoryFilter(filter as NonNullable<typeof filter>)
}

/** The tree without its ids, which a parse mints afresh. */
function shape(node: FilterNode<DirectoryCond>): unknown {
  if (node.kind === "atom") return { cond: node.cond, not: !!node.not }
  return { op: node.op, not: !!node.not, children: node.children.map(shape) }
}
const conds = (text: string) => {
  const filter = parseDirectoryFilter(text)
  return filter && (shape(filter) as { children: unknown[] }).children
}

describe("every Condition prints and parses back unchanged", () => {
  test.each([
    "lang:fa",
    "name:news",
    'name:"daily news"',
    "is:followed",
    "is:followable",
    "subscribers >= 1000",
    "reach <= 500",
    "reach 100..5000",
    "reach = none",
    "posts_per_week >= 2.5",
    "forward_pct <= 30",
    "last_post_days <= 7",
    "found_days 1..30",
    "photos >= 1",
    "videos = none",
    "files <= 3",
    "links >= 10",
    "mine:all",
    "mine:14d",
  ])("%s", (text) => {
    expect(roundTrip(text)).toBe(text)
  })

  test("the opening view", () => {
    expect(OPENING_FILTER).toBe("not is:followed and is:followable")
    expect(roundTrip(OPENING_FILTER)).toBe(OPENING_FILTER)
  })

  test("negation, nesting and OR around an opening Condition", () => {
    const text =
      '(lang:fa or lang:en) and not (is:followed or name:"a b") and subscribers >= 1000'
    expect(roundTrip(text)).toBe(text)
  })
})

describe("what each piece of text means", () => {
  test("a bound is the Post filter's shape, on a Directory measure", () => {
    expect(conds("subscribers >= 1000 reach 1..2 videos = none")).toEqual([
      {
        cond: { type: "measure", measure: "subscribers", min: 1000 },
        not: false,
      },
      {
        cond: { type: "measure", measure: "reach", min: 1, max: 2 },
        not: false,
      },
      { cond: { type: "measure", measure: "videos", none: true }, not: false },
    ])
  })

  test("> and < read as inclusive, as on the other tabs", () => {
    expect(printDirectoryFilter(parseDirectoryFilter("subscribers > 5")!)).toBe(
      "subscribers >= 5",
    )
  })

  test("a bare word is Name contains, so typing a word does something", () => {
    expect(conds("news")).toEqual([
      { cond: { type: "name", value: "news" }, not: false },
    ])
    expect(roundTrip("news")).toBe("name:news")
  })

  test("mine reads a window in days, or none for all time", () => {
    expect(conds("mine:all mine:30d")).toEqual([
      { cond: { type: "mine" }, not: false },
      { cond: { type: "mine", days: 30 }, not: false },
    ])
  })
})

describe("text the server would refuse does not parse", () => {
  test.each([
    ["an unknown is:", "is:dismissed"],
    ["another unknown is:", "is:available"],
    ["an unknown prefix", "tag:news"],
    ["a window that is not days", "mine:week"],
    ["a zero window", "mine:0d"],
    ["an unknown measure", "indeg >= 3"],
    ["a dangling operator", "lang:fa and"],
    ["an unclosed parenthesis", "(lang:fa or lang:en"],
    ["a stray character", "lang:fa $"],
    ["a backwards range", "reach 10..1"],
  ])("%s", (_, text) => {
    expect(parseDirectoryFilter(text)).toBeNull()
  })

  test("a tree past the node bound", () => {
    const wide = Array.from({ length: 101 }, (_, i) => `lang:l${i}`).join(
      " or ",
    )
    expect(parseDirectoryFilter(wide)).toBeNull()
  })

  test("a tree past the depth bound, and one just inside it", () => {
    const six =
      "lang:a or (lang:b and (lang:c or (lang:d and (lang:e or lang:f))))"
    expect(parseDirectoryFilter(six)).not.toBeNull()
    const seven =
      "lang:a or (lang:b and (lang:c or (lang:d and (lang:e or (lang:f and lang:g)))))"
    expect(parseDirectoryFilter(seven)).toBeNull()
  })

  test("a value past the server's length", () => {
    expect(parseDirectoryFilter(`lang:${"x".repeat(17)}`)).toBeNull()
    expect(parseDirectoryFilter(`name:${"x".repeat(257)}`)).toBeNull()
  })

  test("the empty text is the empty filter", () => {
    expect(parseDirectoryFilter("")?.children).toEqual([])
  })
})

describe("chip labels", () => {
  test.each<[DirectoryCond, string]>([
    [{ type: "language", value: "fa" }, "Persian"],
    [{ type: "name", value: "news" }, 'Name contains "news"'],
    [{ type: "flag", value: "followed" }, "Followed"],
    [{ type: "flag", value: "followable" }, "Followable"],
    [
      { type: "measure", measure: "subscribers", min: 1200 },
      "Subscribers ≥ 1.2K",
    ],
    [{ type: "measure", measure: "reach", none: true }, "Reach: no value"],
    [
      { type: "measure", measure: "last_post_days", max: 7 },
      "Days since last post ≤ 7",
    ],
    [{ type: "mine" }, "Cited by your channels"],
    [{ type: "mine", days: 14 }, "Cited by your channels, last 14 days"],
  ])("%j", (cond, label) => {
    expect(directoryConditionLabel(cond, "en")).toBe(label)
  })
})
