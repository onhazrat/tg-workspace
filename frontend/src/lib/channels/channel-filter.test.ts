import { describe, expect, test } from "bun:test"
import type { Channel } from "@/types"
import {
  addFunnel,
  append,
  type ChannelFilter,
  type Cond,
  clearFunnels,
  emptyFilter,
  type FilterNode,
  filterNames,
  funnelledValues,
  groupWith,
  matchesChannelFilter,
  moveNode,
  parseChannelFilter,
  printChannelFilter,
  removeFunnel,
  removeNode,
  replaceCond,
  replaceNode,
  setOp,
  toggleNot,
  unwrap,
  wrap,
} from "./channel-filter"
import type { MetricInputs, MetricKey } from "./channel-metrics"
import { UNTAGGED_TAG_ID } from "./channel-tags"

const channel = (over: Partial<Channel>): Channel =>
  ({ name: "c", tags: [], ...over }) as Channel
const noMetrics: MetricInputs = {
  channelStats: {},
  postsInScopeCounts: {},
  now: 0,
}

const tag = (value: string): Cond => ({ type: "tag", value })
const lang = (value: string): Cond => ({ type: "language", value })
const group = (value: string): Cond => ({ type: "group", value })

let seq = 0
const atom = (cond: Cond, not?: boolean): FilterNode => ({
  kind: "atom",
  id: `a${++seq}`,
  cond,
  ...(not ? { not } : {}),
})
const grp = (
  op: "and" | "or",
  children: FilterNode[],
  not?: boolean,
): FilterNode & { kind: "group" } => ({
  kind: "group",
  id: `g${++seq}`,
  op,
  children,
  ...(not ? { not } : {}),
})
const root = (
  op: "and" | "or",
  children: FilterNode[],
  not?: boolean,
): ChannelFilter => ({ ...grp(op, children, not), id: "root" })

/** The tree with every id dropped, so two trees compare by shape. */
const shape = (n: FilterNode): unknown =>
  n.kind === "atom"
    ? { cond: n.cond, not: !!n.not }
    : { op: n.op, not: !!n.not, children: n.children.map(shape) }

const tech = channel({ name: "tech", tags: ["tech"], language: "en" })
const news = channel({ name: "news", tags: ["news"], language: "fa" })
const bare = channel({ name: "bare", tags: [], settingGroupId: "g1" })

const names = filterNames([
  { id: "g1", name: "Daily news" },
  { id: "g2", name: "slow" },
  { id: "g3", name: "Fast group 2" },
  { id: "g4", name: 'the "best" \\ lang' },
])

const shown = (filter: ChannelFilter) =>
  [tech, news, bare]
    .filter((c) => matchesChannelFilter(filter, c, noMetrics))
    .map((c) => c.name)

describe("evaluation", () => {
  test("an empty filter passes every Channel, negated or not", () => {
    expect(shown(emptyFilter())).toEqual(["tech", "news", "bare"])
    expect(shown({ ...emptyFilter(), not: true })).toEqual([
      "tech",
      "news",
      "bare",
    ])
  })

  test("AND needs every child, OR any", () => {
    expect(shown(root("and", [atom(tag("tech")), atom(lang("en"))]))).toEqual([
      "tech",
    ])
    expect(shown(root("and", [atom(tag("tech")), atom(lang("fa"))]))).toEqual(
      [],
    )
    expect(shown(root("or", [atom(tag("tech")), atom(lang("fa"))]))).toEqual([
      "tech",
      "news",
    ])
  })

  test("NOT flips a Condition, a group and the whole filter", () => {
    expect(shown(root("and", [atom(tag("tech"), true)]))).toEqual([
      "news",
      "bare",
    ])
    expect(
      shown(
        root("and", [grp("or", [atom(tag("tech")), atom(tag("news"))], true)]),
      ),
    ).toEqual(["bare"])
    expect(shown(root("and", [atom(tag("tech"))], true))).toEqual([
      "news",
      "bare",
    ])
  })

  test("nesting evaluates inside out", () => {
    // (tech and en) or (news and not en)
    const filter = root("or", [
      grp("and", [atom(tag("tech")), atom(lang("en"))]),
      grp("and", [atom(tag("news")), atom(lang("en"), true)]),
    ])
    expect(shown(filter)).toEqual(["tech", "news"])
  })

  test("an empty nested group passes, even negated", () => {
    expect(
      shown(root("and", [grp("or", [], true), atom(tag("news"))])),
    ).toEqual(["news"])
  })

  test("Setting group, Language and the derived tags are Conditions", () => {
    expect(shown(root("and", [atom(group("g1"))]))).toEqual(["bare"])
    expect(shown(root("and", [atom(lang("fa"))]))).toEqual(["news"])
    expect(shown(root("and", [atom(tag(UNTAGGED_TAG_ID))]))).toEqual(["bare"])
  })
})

describe("number Conditions", () => {
  const DAY = 86_400_000
  const now = 100 * DAY
  const measured = channel({
    name: "m",
    subscribers: 500,
    photos: 3,
    videos: 4,
    files: 5,
    links: 6,
    lastUpdated: now - 2 * DAY,
    followedAt: now - 30 * DAY,
  })
  const unmeasured = channel({ name: "u" })
  const inputs: MetricInputs = {
    channelStats: {
      m: { count: 90, reach: 1200, reachEstimated: false, velocity: 0.5 },
    },
    postsInScopeCounts: { m: 7 },
    now,
  }
  const bound = (
    key: MetricKey,
    b: { min?: number; max?: number; none?: true },
  ): ChannelFilter => root("and", [atom({ type: "metric", metric: key, ...b })])
  const passes = (filter: ChannelFilter, c: Channel) =>
    matchesChannelFilter(filter, c, inputs)

  const VALUES: [MetricKey, number][] = [
    ["subscribers", 500],
    ["reach", 1200],
    ["activity_rate", 0.5],
    ["total_posts", 90],
    ["posts_in_scope", 7],
    ["days_since_update", 2],
    ["days_followed", 30],
    ["photos", 3],
    ["videos", 4],
    ["files", 5],
    ["links", 6],
  ]

  test.each(VALUES)(
    "%s is read from where the tab has it, both edges inclusive",
    (key, value) => {
      expect(passes(bound(key, { min: value }), measured)).toBe(true)
      expect(passes(bound(key, { max: value }), measured)).toBe(true)
      expect(passes(bound(key, { min: value, max: value }), measured)).toBe(
        true,
      )
      expect(passes(bound(key, { min: value * 1.01 }), measured)).toBe(false)
      expect(passes(bound(key, { max: value * 0.99 }), measured)).toBe(false)
    },
  )

  test.each(VALUES.filter(([key]) => key !== "posts_in_scope"))(
    "a Channel with no %s fails any bound, and only it passes no value",
    (key) => {
      expect(passes(bound(key, { min: 0 }), unmeasured)).toBe(false)
      expect(passes(bound(key, { max: 1e12 }), unmeasured)).toBe(false)
      expect(passes(bound(key, { none: true }), unmeasured)).toBe(true)
      expect(passes(bound(key, { none: true }), measured)).toBe(false)
    },
  )

  test("NOT of a bound passes a missing value; NOT of no value means has one", () => {
    const notBound = root("and", [
      atom({ type: "metric", metric: "reach", min: 5000 }, true),
    ])
    expect(passes(notBound, unmeasured)).toBe(true)
    expect(passes(notBound, measured)).toBe(true)
    const hasValue = root("and", [
      atom({ type: "metric", metric: "reach", none: true }, true),
    ])
    expect(passes(hasValue, measured)).toBe(true)
    expect(passes(hasValue, unmeasured)).toBe(false)
  })

  test("every Channel has Posts in the Scope, none counting as 0", () => {
    expect(passes(bound("posts_in_scope", { max: 0 }), unmeasured)).toBe(true)
    expect(passes(bound("posts_in_scope", { none: true }), unmeasured)).toBe(
      false,
    )
  })
})

describe("editing", () => {
  test("remove drops empty groups and unwraps one-child groups", () => {
    const a = atom(tag("a"))
    const b = atom(tag("b"))
    const c = atom(tag("c"))
    const filter = root("and", [grp("or", [a, b]), c])
    expect(shape(removeNode(filter, a.id))).toEqual(shape(root("and", [b, c])))
    const lone = root("and", [grp("or", [a]), c])
    expect(shape(removeNode(lone, a.id))).toEqual(shape(root("and", [c])))
  })

  test("unwrapping keeps the negation: not (a) is not a, not (not a) is a", () => {
    const a = atom(tag("a"))
    const b = atom(tag("b"))
    const na = atom(tag("a"), true)
    const nb = atom(tag("b"))
    expect(
      shape(removeNode(root("and", [grp("or", [a, b], true)]), b.id)),
    ).toEqual(shape(root("and", [atom(tag("a"), true)])))
    expect(
      shape(removeNode(root("and", [grp("or", [na, nb], true)]), nb.id)),
    ).toEqual(shape(root("and", [atom(tag("a"))])))
  })

  test("append, replace, setOp and toggleNot", () => {
    let filter = append(emptyFilter(), "root", tag("a"))
    const [first] = filter.children
    filter = replaceNode(filter, first.id, {
      ...first,
      cond: tag("b"),
    } as FilterNode)
    filter = append(filter, "root", tag("c"))
    filter = setOp(filter, "root", "or")
    filter = toggleNot(filter, filter.children[1].id)
    expect(shape(filter)).toEqual(
      shape(root("or", [atom(tag("b")), atom(tag("c"), true)])),
    )
    expect(toggleNot(filter, "root").not).toBe(true)
  })

  test("replaceCond swaps a Condition and keeps its NOT", () => {
    const a = atom(tag("a"), true)
    const next = replaceCond(root("and", [a]), a.id, tag("b"))
    expect(shape(next)).toEqual(shape(root("and", [atom(tag("b"), true)])))
    const g = grp("or", [atom(tag("x")), atom(tag("y"))])
    const filter = root("and", [g])
    expect(replaceCond(filter, g.id, tag("b"))).toBe(filter)
  })

  test("move reorders and prunes what it leaves behind", () => {
    const a = atom(tag("a"))
    const b = atom(tag("b"))
    const c = atom(tag("c"))
    const inner = grp("or", [a, b])
    const filter = root("and", [inner, c])
    // Move a out, after c: the group left with b alone is unwrapped.
    expect(shape(moveNode(filter, a.id, "root", 2))).toEqual(
      shape(root("and", [b, c, a])),
    )
    // Move c to the front.
    expect(shape(moveNode(filter, c.id, "root", 0))).toEqual(
      shape(root("and", [c, inner])),
    )
  })

  test("a group cannot move into itself", () => {
    const inner = grp("or", [
      atom(tag("a")),
      grp("and", [atom(tag("b")), atom(tag("c"))]),
    ])
    const filter = root("and", [inner, atom(tag("d"))])
    const deeper = (inner.children[1] as { id: string }).id
    expect(moveNode(filter, inner.id, inner.id, 0)).toBe(filter)
    expect(moveNode(filter, inner.id, deeper, 0)).toBe(filter)
  })

  test("wrap puts a node in parentheses; groupWith takes the opposite operator", () => {
    const a = atom(tag("a"))
    const b = atom(tag("b"))
    const c = atom(tag("c"))
    const filter = root("and", [a, b, c])
    expect(shape(wrap(filter, a.id, "or"))).toEqual(
      shape(root("and", [grp("or", [a]), b, c])),
    )
    expect(shape(groupWith(filter, c.id, a.id))).toEqual(
      shape(root("and", [grp("or", [a, c]), b])),
    )
  })

  test("NOT on the root negates the whole filter, and again restores it", () => {
    const filter = root("or", [atom(tag("tech")), atom(tag("news"))])
    expect(shown(toggleNot(filter, "root"))).toEqual(["bare"])
    expect(shown(toggleNot(toggleNot(filter, "root"), "root"))).toEqual([
      "tech",
      "news",
    ])
  })

  test("groupWith joins nodes from different depths, pruning where the dragged one was", () => {
    const a = atom(tag("a"))
    const b = atom(tag("b"))
    const c = atom(tag("c"))
    const d = atom(tag("d"))
    // Drag b out of (a or b) onto d at the root: (a or b) is left holding a.
    const filter = root("and", [grp("or", [a, b]), c, d])
    expect(shape(groupWith(filter, b.id, d.id))).toEqual(
      shape(root("and", [a, c, grp("or", [d, b])])),
    )
    // Drag the root-level c onto the nested a: the new group is inside an
    // OR, so it is an AND.
    expect(shape(groupWith(filter, c.id, a.id))).toEqual(
      shape(root("and", [grp("or", [grp("and", [a, c]), b]), d])),
    )
  })

  test("a node cannot be dropped onto its own parentheses", () => {
    const a = atom(tag("a"))
    const inner = grp("or", [a, atom(tag("b"))])
    const filter = root("and", [inner, atom(tag("c"))])
    expect(groupWith(filter, a.id, inner.id)).toBe(filter)
    expect(groupWith(filter, inner.id, a.id)).toBe(filter)
  })

  test("unwrap splices a group's children into its parent", () => {
    const a = atom(tag("a"))
    const b = atom(tag("b"))
    const c = atom(tag("c"))
    const inner = grp("or", [a, b])
    expect(shape(unwrap(root("and", [inner, c]), inner.id))).toEqual(
      shape(root("and", [a, b, c])),
    )
  })
})

describe("funnels", () => {
  test("the first funnel of a type appends to the root", () => {
    const filter = addFunnel(emptyFilter(), "tag", "tech")
    expect(shape(filter)).toEqual(shape(root("and", [atom(tag("tech"))])))
  })

  test("a second of the same type makes an OR group, later ones join it", () => {
    let filter = addFunnel(emptyFilter(), "tag", "tech")
    filter = addFunnel(filter, "language", "fa")
    filter = addFunnel(filter, "tag", "news")
    expect(shape(filter)).toEqual(
      shape(
        root("and", [
          grp("or", [atom(tag("tech")), atom(tag("news"))]),
          atom(lang("fa")),
        ]),
      ),
    )
    filter = addFunnel(filter, "tag", "spam")
    expect(shape(filter)).toEqual(
      shape(
        root("and", [
          grp("or", [atom(tag("tech")), atom(tag("news")), atom(tag("spam"))]),
          atom(lang("fa")),
        ]),
      ),
    )
    expect(funnelledValues(filter, "tag")).toEqual(["tech", "news", "spam"])
  })

  test("a different type joins with AND even when the root is an OR", () => {
    const filter = addFunnel(
      root("or", [atom(tag("a")), atom(lang("en"))]),
      "group",
      "g1",
    )
    expect(filter.op).toBe("and")
    expect(shared(filter)).toEqual(["a|en", "g1"])
  })

  test("a funnel never ANDs into a negated root", () => {
    const filter = addFunnel(root("and", [atom(tag("a"))], true), "tag", "b")
    // "not a", then a b funnel, is "not a and b", never "not (a and b)".
    expect(filter.not).toBeFalsy()
    expect(
      matchesChannelFilter(filter, channel({ tags: ["b"] }), noMetrics),
    ).toBe(true)
    expect(matchesChannelFilter(filter, channel({ tags: [] }), noMetrics)).toBe(
      false,
    )
    expect(
      matchesChannelFilter(filter, channel({ tags: ["a", "b"] }), noMetrics),
    ).toBe(false)
  })

  test("after a hand edit, a funnel appends and never reshapes", () => {
    const big: Cond = { type: "metric", metric: "reach", min: 200 }
    const built = grp("or", [
      grp("and", [atom(tag("tech")), atom(big)]),
      atom(lang("fa"), true),
    ])
    const byHand = root("and", [built, atom(group("g1"))])
    // A tag funnel: the lone root-level tag it would join is not there, so
    // it appends, and what was built stays as it was.
    expect(shape(addFunnel(byHand, "tag", "news"))).toEqual(
      shape(root("and", [built, atom(group("g1")), atom(tag("news"))])),
    )
    // Unfunnelling tech removes that Condition only.
    expect(shape(removeFunnel(byHand, "tag", "tech"))).toEqual(
      shape(
        root("and", [
          grp("or", [atom(big), atom(lang("fa"), true)]),
          atom(group("g1")),
        ]),
      ),
    )
  })

  test("an existing funnel is not added twice", () => {
    const filter = addFunnel(emptyFilter(), "tag", "tech")
    expect(addFunnel(filter, "tag", "tech")).toBe(filter)
  })

  test("unfunnelling removes every Condition with that value, anywhere", () => {
    const filter = root("and", [
      grp("or", [atom(tag("tech")), atom(tag("news"))]),
      atom(tag("tech"), true),
      atom(lang("fa")),
    ])
    expect(shape(removeFunnel(filter, "tag", "tech"))).toEqual(
      shape(root("and", [atom(tag("news")), atom(lang("fa"))])),
    )
    expect(shape(clearFunnels(filter, "tag"))).toEqual(
      shape(root("and", [atom(lang("fa"))])),
    )
  })
})

const condValue = (cond: Cond) =>
  cond.type === "metric" ? cond.metric : cond.value

/** Root children as text, groups joined by "|", to read a shape at a glance. */
function shared(filter: ChannelFilter): string[] {
  return filter.children.map((n) =>
    n.kind === "atom"
      ? condValue(n.cond)
      : n.children
          .map((c) => (c.kind === "atom" ? condValue(c.cond) : "()"))
          .join("|"),
  )
}

describe("the URL form", () => {
  const roundTrip = (filter: ChannelFilter) => {
    const text = printChannelFilter(filter, names)
    const parsed = parseChannelFilter(text, names)
    expect(parsed ? shape(parsed) : parsed).toEqual(shape(filter))
    return text
  }

  test("prints readable text", () => {
    expect(
      printChannelFilter(
        root("or", [
          grp("and", [atom(tag("tech")), atom(lang("fa"))]),
          atom(group("g1"), true),
        ]),
        names,
      ),
    ).toBe('(tag:tech and lang:fa) or not group:"Daily news"')
  })

  test("printing then parsing gives back the same tree", () => {
    roundTrip(emptyFilter())
    roundTrip(root("and", [atom(tag("tech"))]))
    roundTrip(root("and", [atom(tag("tech"), true)]))
    roundTrip(root("or", [atom(tag("a")), atom(tag("b"))]))
    roundTrip(root("and", [grp("or", [atom(tag("a")), atom(tag("b"))])]))
    roundTrip(root("and", [grp("or", [atom(tag("a")), atom(tag("b"))], true)]))
    roundTrip(root("and", [atom(tag("a")), atom(tag("b"))], true))
    roundTrip(root("and", [atom(tag("a"))], true))
    roundTrip(
      root("and", [
        grp("or", [
          atom(tag("a")),
          grp("and", [atom(group("g2")), atom(lang("fa"))]),
        ]),
        atom(tag("x y"), true),
        atom(tag(UNTAGGED_TAG_ID)),
      ]),
    )
  })

  test("a chip put in parentheses by itself survives the URL", () => {
    // The row's state is the URL, so a wrap that did not print would undo
    // itself. Its operator is not written; it reads back as the opposite of
    // its parent's, which is what wrapping gives it.
    const a = atom(tag("a"))
    const b = atom(tag("b"))
    expect(roundTrip(wrap(root("and", [a, b]), a.id, "or"))).toBe(
      "(tag:a) and tag:b",
    )
    roundTrip(wrap(root("or", [a, b]), b.id, "and"))
    roundTrip(wrap(root("and", [a]), a.id, "or"))
    roundTrip(
      root("and", [grp("or", [grp("and", [atom(tag("a"))]), atom(tag("b"))])]),
    )
  })

  test("reads the spec's example shape, AND binding tighter than OR", () => {
    // The spec's example with tags in place of its numbers.
    const parsed = parseChannelFilter(
      "(tag tech and big) or (tag news and (small or popular) and (slow or important))",
      names,
    )
    expect(parsed ? shape(parsed) : parsed).toEqual(
      shape(
        root("or", [
          grp("and", [atom(tag("tech")), atom(tag("big"))]),
          grp("and", [
            atom(tag("news")),
            grp("or", [atom(tag("small")), atom(tag("popular"))]),
            grp("or", [atom(tag("slow")), atom(tag("important"))]),
          ]),
        ]),
      ),
    )
    const loose = parseChannelFilter("not a or b and c", names)
    expect(loose ? shape(loose) : loose).toEqual(
      shape(
        root("or", [
          atom(tag("a"), true),
          grp("and", [atom(tag("b")), atom(tag("c"))]),
        ]),
      ),
    )
  })

  const reach = (b: { min?: number; max?: number; none?: true }): Cond => ({
    type: "metric",
    metric: "reach",
    ...b,
  })

  test("number Conditions print and read back", () => {
    expect(roundTrip(root("and", [atom(reach({ min: 200 }))]))).toBe(
      "reach >= 200",
    )
    expect(
      roundTrip(
        root("and", [
          atom({ type: "metric", metric: "subscribers", max: 100 }),
        ]),
      ),
    ).toBe("subscribers <= 100")
    expect(roundTrip(root("and", [atom(reach({ min: 200, max: 1000 }))]))).toBe(
      "reach 200..1000",
    )
    expect(roundTrip(root("and", [atom(reach({ none: true }))]))).toBe(
      "reach = none",
    )
    expect(roundTrip(root("and", [atom(reach({ none: true }), true)]))).toBe(
      "not reach = none",
    )
    roundTrip(
      root("or", [
        atom({ type: "metric", metric: "activity_rate", min: 0.25 }),
        atom({ type: "metric", metric: "days_followed", max: 1.5e-7 }),
        grp("and", [atom(reach({ min: -3 })), atom(tag("reach"))]),
      ]),
    )
  })

  test("reads the spec's own example", () => {
    const parsed = parseChannelFilter(
      "(tag tech and reach > 200) or (tag news and (subscribers > 100 or reach > 1000) and (activity rate < 10 or important))",
      names,
    )
    const metricAtom = (metric: MetricKey, b: { min?: number; max?: number }) =>
      atom({ type: "metric", metric, ...b })
    const expected = root("or", [
      grp("and", [atom(tag("tech")), metricAtom("reach", { min: 200 })]),
      grp("and", [
        atom(tag("news")),
        grp("or", [
          metricAtom("subscribers", { min: 100 }),
          metricAtom("reach", { min: 1000 }),
        ]),
        grp("or", [
          metricAtom("activity_rate", { max: 10 }),
          atom(tag("important")),
        ]),
      ]),
    ])
    expect(parsed ? shape(parsed) : parsed).toEqual(shape(expected))
    roundTrip(expected)
  })

  test("a number word with no comparison is a tag, and a half comparison fails", () => {
    const parsed = parseChannelFilter("reach", names)
    expect(parsed ? shape(parsed) : parsed).toEqual(
      shape(root("and", [atom(tag("reach"))])),
    )
    for (const text of ["reach >", "reach >= x", "reach = nothing"]) {
      expect(parseChannelFilter(text, names)).toBeNull()
    }
  })

  test("Setting groups are read by name or by id, and derived tags by label", () => {
    for (const text of ['group:"daily news"', "group:g1"]) {
      const parsed = parseChannelFilter(text, names)
      expect(parsed ? shape(parsed) : parsed).toEqual(
        shape(root("and", [atom(group("g1"))])),
      )
    }
    expect(
      printChannelFilter(root("and", [atom(tag(UNTAGGED_TAG_ID))]), names),
    ).toBe("tag:Untagged")
  })

  test("a malformed string is not a filter", () => {
    for (const text of [
      "(tag:a",
      "tag:a)",
      "and",
      "foo:bar",
      "a >",
      'tag:"a',
    ]) {
      expect(parseChannelFilter(text, names)).toBeNull()
    }
  })

  test("names holding keywords, spaces, quotes and backslashes round-trip", () => {
    roundTrip(
      root("and", [
        atom(group("g3")),
        atom(group("g4")),
        atom(tag("my tag list")),
        atom(tag("lang")),
        atom(tag("group")),
        atom(tag('say "hi"')),
        atom(lang("fa")),
      ]),
    )
    expect(printChannelFilter(root("and", [atom(group("g3"))]), names)).toBe(
      'group:"Fast group 2"',
    )
  })

  test("a Setting group nobody has is kept by its text and matches nothing", () => {
    // Setting groups load after the URL, and a shared link may name one this
    // Account lacks: the Condition stays, rather than the whole filter going.
    const parsed = parseChannelFilter('group:"Not yet" and tag:tech', names)
    expect(parsed ? shape(parsed) : parsed).toEqual(
      shape(root("and", [atom(group("Not yet")), atom(tag("tech"))])),
    )
    roundTrip(parsed as ChannelFilter)
    expect(shown(parsed as ChannelFilter)).toEqual([])
  })
})
