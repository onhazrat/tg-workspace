/**
 * The Directory filter's text form (DIR-02): what `?dirFilter=` holds. Every
 * Condition prints and parses back unchanged, a bare word reads as Name
 * contains, and anything the server would refuse (an unknown `is:`, a
 * malformed window, a tree past the bounds) does not parse. DFP-05 renames
 * the Shared picks to Seeds, adds a Tag as their source, and keeps reading
 * the old `picked`.
 */
import { describe, expect, test } from "bun:test"
import type { FilterNode } from "@/lib/filter-tree"
import {
  type DirectoryCond,
  directoryConditionLabel,
  directoryFilterBody,
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
    "is:dismissed",
    "subscribers >= 1000",
    "reach <= 500",
    "reach 100..5000",
    "reach = none",
    "posts_per_week >= 2.5",
    "forward_pct <= 30",
    "sample_count >= 5",
    "priority_boost <= -3",
    "effective_priority -10..10",
    "photos >= 1",
    "videos = none",
    "files <= 3",
    "links >= 10",
    "mine:all",
    "mine:-2w..",
    "mine:-30d..-1w",
    "mine:..-3d",
    'mine:"2026-10-01T00:00Z..2026-10-15T00:00Z"',
    "cited_by >= 5",
    "cites <= 0",
    "citedby:durov",
    'cites:"alpha beta"',
    'citedby:"tag:news"',
    'cites:"tag:World News"',
    "tag:news",
    'tag:"slow reads"',
    "not tag:news",
    'group:"Slow Feed"',
    "not group:slow",
    'citedby:"group:Slow Feed"',
    'parents:"group:slow 3"',
  ])("%s", (text) => {
    expect(roundTrip(text)).toBe(text)
  })

  test("the opening view", () => {
    expect(OPENING_FILTER).toBe(
      "not is:followed and not is:dismissed and is:followable",
    )
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

  test("mine reads a Time bound, or none for all time (TB-02)", () => {
    expect(conds('mine:all mine:-30d..-1w mine:"2026-10-01T00:00Z.."')).toEqual(
      [
        { cond: { type: "mine" }, not: false },
        {
          cond: { type: "mine", mode: "live", start: -30 * DAY, end: -7 * DAY },
          not: false,
        },
        {
          cond: { type: "mine", mode: "fixed", start: Date.UTC(2026, 9, 1) },
          not: false,
        },
      ],
    )
  })

  test("an old mine:14d link reads as Live from 14 days ago, End open", () => {
    expect(conds("mine:14d")).toEqual([
      { cond: { type: "mine", mode: "live", start: -14 * DAY }, not: false },
    ])
    expect(roundTrip("mine:14d")).toBe("mine:-2w..")
  })
})

const DAY = 86_400_000

describe("Time bounds (DPF)", () => {
  test.each([
    "status:unavailable",
    "status:private",
    "kind:bot",
    "error:timeout",
    'error:"proxy timeout"',
    "checked_at 2026-10-01T00:00Z..",
    "checked_at ..2026-10-15T12:30Z",
    "checked_at 2026-10-01T00:00Z..2026-10-15T00:00Z",
    "refresh_due_at now..+2d",
    "last_post_at -3d..",
    "created_at ..-50d",
    "attempted_at -90m..-1h",
    "retry_after = none",
    "not last_post_at -1w..",
  ])("%s prints and parses back unchanged", (text) => {
    expect(roundTrip(text)).toBe(text)
  })

  test("a Live end is signed ms from now, a Fixed end a UTC instant", () => {
    expect(
      conds("refresh_due_at now..+2d checked_at 2026-10-01T00:00Z.."),
    ).toEqual([
      {
        cond: {
          type: "time",
          moment: "refresh_due_at",
          mode: "live",
          start: 0,
          end: 2 * DAY,
        },
        not: false,
      },
      {
        cond: {
          type: "time",
          moment: "checked_at",
          mode: "fixed",
          start: Date.UTC(2026, 9, 1),
        },
        not: false,
      },
    ])
  })

  test("a Fixed end prints in UTC whatever the reader's zone", () => {
    const cond: DirectoryCond = {
      type: "time",
      moment: "checked_at",
      mode: "fixed",
      start: Date.UTC(2026, 9, 1, 20, 30, 15),
    }
    expect(
      printDirectoryFilter({
        kind: "group",
        id: "root",
        op: "and",
        children: [{ kind: "atom", id: "a", cond }],
      }),
    ).toBe("checked_at 2026-10-01T20:30:15Z..")
  })

  test.each([
    ["the old day measure", "last_post_days <= 7"],
    ["the other old day measure", "found_days 1..30"],
    ["no end at all", "checked_at .."],
    ["a Live and a Fixed end", "checked_at now..2026-10-01T00:00Z"],
    ["an end before the start", "checked_at -1d..-2d"],
    ["an unknown kind", "kind:robot"],
    ["an unknown status", "status:fine"],
  ])("%s does not parse", (_, text) => {
    expect(parseDirectoryFilter(text)).toBeNull()
  })

  test.each<[DirectoryCond, string]>([
    [
      { type: "time", moment: "last_post_at", mode: "live", start: -3 * DAY },
      "Last post from 3 days ago",
    ],
    [
      { type: "time", moment: "created_at", mode: "live", end: -50 * DAY },
      "Found before 50 days ago",
    ],
    [
      {
        type: "time",
        moment: "refresh_due_at",
        mode: "live",
        start: 0,
        end: 2 * DAY,
      },
      "Refresh due from now to in 2 days",
    ],
    [
      { type: "time", moment: "retry_after", mode: "fixed", none: true },
      "Retry after: no value",
    ],
  ])("%j", (cond, label) => {
    expect(directoryConditionLabel(cond, "en", "UTC")).toBe(label)
  })

  test("a Fixed end reads as a date and time in the zone it is shown in", () => {
    // Pinned to the formatter, not to its text: ICU versions disagree on the
    // joiner ("Oct 1, 2026, 9:05 AM" on CI, "Oct 1, 2026 at 9:05 AM" on macOS).
    const start = Date.UTC(2026, 9, 1, 9, 5)
    const cond: DirectoryCond = {
      type: "time",
      moment: "checked_at",
      mode: "fixed",
      start,
    }
    const at = (timeZone: string) =>
      new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      }).format(start)
    expect(directoryConditionLabel(cond, "en", "UTC")).toBe(
      `Checked from ${at("UTC")}`,
    )
    expect(at("UTC")).toContain("9:05")
    expect(directoryConditionLabel(cond, "en", "Asia/Tehran")).toContain(
      "12:35",
    )
  })
})

describe("cited by @x and cites @x", () => {
  test("one or several handles, lowercased, @ optional inside quotes", () => {
    expect(conds('citedby:Durov cites:"alpha, @Beta"')).toEqual([
      {
        cond: {
          type: "citedby",
          seeds: { kind: "handles", handles: ["durov"] },
        },
        not: false,
      },
      {
        cond: {
          type: "cites",
          seeds: { kind: "handles", handles: ["alpha", "beta"] },
        },
        not: false,
      },
    ])
  })

  test("a Tag as the Seeds, named as typed (DFP-05)", () => {
    expect(conds('citedby:"tag:World News"')).toEqual([
      {
        cond: { type: "citedby", seeds: { kind: "tag", name: "World News" } },
        not: false,
      },
    ])
  })

  test("the server's limit of 500 handles (DFP-05)", () => {
    const handles = (n: number) =>
      Array.from({ length: n }, (_, i) => `h${i}`).join(" ")
    expect(parseDirectoryFilter(`cites:"${handles(500)}"`)).not.toBeNull()
    expect(parseDirectoryFilter(`cites:"${handles(501)}"`)).toBeNull()
  })
})

describe("text the server would refuse does not parse", () => {
  test.each([
    ["another unknown is:", "is:available"],
    ["an unknown prefix", "topic:news"],
    ["a window that is not days", "mine:week"],
    ["a zero window", "mine:0d"],
    ["a window with no end", "mine:.."],
    ["a backwards window", "mine:-1d..-2d"],
    ["a window mixing Live and Fixed", 'mine:"-1d..2026-10-01T00:00Z"'],
    ["a Live window past a century", "mine:-6000w.."],
    ["a Live Time bound past a century", "last_post_at -6000w.."],
    ["an unknown measure", "indeg >= 3"],
    ["a dangling operator", "lang:fa and"],
    ["an unclosed parenthesis", "(lang:fa or lang:en"],
    ["a stray character", "lang:fa $"],
    ["a backwards range", "reach 10..1"],
    ["no handle", 'citedby:"@"'],
    ["no Tag name", 'citedby:"tag:"'],
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
    [{ type: "flag", value: "dismissed" }, "Dismissed"],
    [
      { type: "measure", measure: "subscribers", min: 1200 },
      "Subscribers ≥ 1.2K",
    ],
    [{ type: "measure", measure: "reach", none: true }, "Reach: no value"],
    [{ type: "measure", measure: "sample_count", min: 5 }, "Sample size ≥ 5"],
    [
      { type: "is", field: "status", value: "unavailable" },
      "Status is unavailable",
    ],
    [{ type: "is", field: "kind", value: "bot" }, "Kind is bot"],
    [
      { type: "contains", field: "last_error", value: "timeout" },
      'Last error contains "timeout"',
    ],
    [{ type: "mine" }, "Cited by your channels"],
    [
      { type: "mine", mode: "live", start: -14 * 86_400_000 },
      "Cited by your channels from 2 weeks ago",
    ],
    [
      { type: "mine", mode: "live", start: -30 * 86_400_000, end: -86_400_000 },
      "Cited by your channels from 30 days ago to 1 day ago",
    ],
    [
      { type: "measure", measure: "cited_by", min: 10 },
      "Cited by (channels) ≥ 10",
    ],
    [
      { type: "citedby", seeds: { kind: "handles", handles: ["durov"] } },
      "Cited by @durov",
    ],
    [
      { type: "cites", seeds: { kind: "handles", handles: ["a", "b"] } },
      "Cites @a, @b",
    ],
    [
      { type: "citedby", seeds: { kind: "tag", name: "news" } },
      "Cited by the Tag news",
    ],
  ])("%j", (cond, label) => {
    expect(directoryConditionLabel(cond, "en")).toBe(label)
  })
})

describe("Shared parents and Shared children (DIR-07)", () => {
  test.each([
    "parents:ticked",
    "parents:selection",
    "parents:follows",
    'parents:"tag:news"',
    'children:"tag:World News 3"',
    // A Tag name ending in a number keeps its minimum written out.
    'parents:"tag:top 10 2"',
    'children:"a b 3"',
    'parents:"ticked 3"',
    'children:"alpha beta"',
    'not parents:follows and children:"follows 5"',
  ])("%s prints and parses back unchanged", (text) => {
    expect(roundTrip(text)).toBe(text)
  })

  test("the Seeds, and a trailing number as the minimum (default 2)", () => {
    expect(
      conds('parents:ticked children:"@Alpha, beta 3" parents:"tag:news 4"'),
    ).toEqual([
      {
        cond: { type: "parents", seeds: { kind: "ticked" }, min: 2 },
        not: false,
      },
      {
        cond: {
          type: "children",
          seeds: { kind: "handles", handles: ["alpha", "beta"] },
          min: 3,
        },
        not: false,
      },
      {
        cond: { type: "parents", seeds: { kind: "tag", name: "news" }, min: 4 },
        not: false,
      },
    ])
  })

  test.each([
    ["parents:picked", "parents:ticked"],
    ['children:"picked 3"', 'children:"ticked 3"'],
  ])("a link with the old word %s still parses, as %s", (old, now) => {
    expect(roundTrip(old)).toBe(now)
  })

  test.each([
    ["no Seeds", 'parents:"3"'],
    ["no Tag name", 'parents:"tag: 3"'],
    ["a zero minimum", 'parents:"follows 0"'],
    ["no handle", 'children:"@ 3"'],
  ])("%s does not parse", (_, text) => {
    expect(parseDirectoryFilter(text)).toBeNull()
  })

  test.each<[DirectoryCond, string]>([
    [
      { type: "parents", seeds: { kind: "ticked" }, min: 2 },
      "2+ shared parents with the channels ticked here",
    ],
    [
      { type: "children", seeds: { kind: "selection" }, min: 3 },
      "3+ shared children with your selected channels",
    ],
    [
      { type: "parents", seeds: { kind: "follows" }, min: 2 },
      "2+ shared parents with your follows",
    ],
    [
      {
        type: "children",
        seeds: { kind: "handles", handles: ["a", "b"] },
        min: 2,
      },
      "2+ shared children with @a, @b",
    ],
    [
      { type: "parents", seeds: { kind: "tag", name: "news" }, min: 2 },
      "2+ shared parents with the Tag news",
    ],
  ])("%j reads as its chip", (cond, label) => {
    expect(directoryConditionLabel(cond, "en")).toBe(label)
  })

  test("the body sends the Seeds as handles resolved now, or the Tag's name", () => {
    const filter = parseDirectoryFilter(
      'parents:ticked or children:follows or parents:selection or children:"x 4" or parents:"tag:News" or citedby:"tag:news" or cites:y',
    )
    const body = directoryFilterBody(filter as NonNullable<typeof filter>, {
      ticked: ["t1"],
      selection: ["s1", "s2"],
      follows: ["f1"],
    })
    expect(body?.children?.map((c) => c.kind === "atom" && c.cond)).toEqual([
      { type: "parents", handles: ["t1"], min: 2 },
      { type: "children", handles: ["f1"], min: 2 },
      { type: "parents", handles: ["s1", "s2"], min: 2 },
      { type: "children", handles: ["x"], min: 4 },
      { type: "parents", tag: "News", min: 2 },
      { type: "citedby", tag: "news" },
      { type: "cites", handles: ["y"] },
    ])
  })
})

describe("the tag Condition (DFP-04)", () => {
  test("names the Tag as typed and goes to the server as it is", () => {
    const filter = parseDirectoryFilter('not tag:"World News"')
    expect(conds('tag:"World News"')).toEqual([
      { cond: { type: "tag", name: "World News" }, not: false },
    ])
    expect(directoryConditionLabel({ type: "tag", name: "news" })).toBe(
      "In the Tag news",
    )
    const body = directoryFilterBody(filter as NonNullable<typeof filter>, {
      ticked: [],
      selection: [],
      follows: [],
    })
    expect(body?.children?.[0]).toMatchObject({
      not: true,
      cond: { type: "tag", name: "World News" },
    })
  })
})

describe("the Setting group Condition (TGU-04)", () => {
  const none = { ticked: [], selection: [], follows: [] }

  test("names the group and goes to the server by name", () => {
    expect(conds('group:"Slow Feed"')).toEqual([
      { cond: { type: "group", name: "Slow Feed" }, not: false },
    ])
    expect(directoryConditionLabel({ type: "group", name: "Slow" })).toBe(
      "In the Setting group Slow",
    )
    const filter = parseDirectoryFilter("group:Slow")
    const body = directoryFilterBody(filter as NonNullable<typeof filter>, none)
    expect(body?.children?.[0]).toMatchObject({
      cond: { type: "group", name: "Slow" },
    })
  })

  test("an old group: Tag link reads as the group, and prints as one", () => {
    expect(conds('not tag:"group:Slow Feed"')).toEqual([
      { cond: { type: "group", name: "Slow Feed" }, not: true },
    ])
    expect(roundTrip('tag:"GROUP:Slow"')).toBe("group:Slow")
    expect(conds('tag:"group: "')).toBeNull()
  })

  test("is a Seed source, sent by name; an old tag:group: Seed too", () => {
    expect(conds('citedby:"tag:group:Slow" parents:"group:Slow 3"')).toEqual([
      {
        cond: { type: "citedby", seeds: { kind: "group", name: "Slow" } },
        not: false,
      },
      {
        cond: {
          type: "parents",
          seeds: { kind: "group", name: "Slow" },
          min: 3,
        },
        not: false,
      },
    ])
    expect(
      directoryConditionLabel({
        type: "cites",
        seeds: { kind: "group", name: "Slow" },
      }),
    ).toBe("Cites the Setting group Slow")
    const filter = parseDirectoryFilter(
      'cites:"group:Slow" children:"group:Slow"',
    )
    const body = directoryFilterBody(filter as NonNullable<typeof filter>, none)
    expect(body?.children?.map((c) => c.kind === "atom" && c.cond)).toEqual([
      { type: "cites", group: "Slow" },
      { type: "children", group: "Slow", min: 2 },
    ])
  })
})
