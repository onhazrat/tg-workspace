import { describe, expect, test } from "bun:test"

import { type PostFilter, parsePostFilter } from "./post-filter"
import {
  NO_RANKING,
  type PostsRead,
  type PostsView,
  postsRead,
  scopeSubmission,
} from "./posts-view"

const filter = (src: string): PostFilter => {
  const parsed = parsePostFilter(src)
  if (!parsed) throw new Error(`unparsable: ${src}`)
  return parsed
}

const base: PostsView = {
  scopeChannelNames: ["durov", "news"],
  channelNames: ["durov", "news"],
  keyword: "",
  ranking: NO_RANKING,
  respectsChannels: false,
  filter: filter("lang:fa"),
  maxPerChannel: 5,
  maxPerChannelMode: "ordered",
  sort: "newest",
  groupByChannel: false,
  viewMeasure: "estimated",
  startDate: 1_000_000,
  endDate: 2_000_000,
  windowKey: { mode: "live", durationMs: 1_000_000, endGapMs: 0 },
  selection: [{ kind: "pick", select: true, channelName: "news", postId: 1 }],
  selectionRevision: 1,
}

/** Each field of the view, changed to something that means something else. */
const changes = {
  scopeChannelNames: { scopeChannelNames: ["durov", "news", "rates"] },
  channelNames: { channelNames: ["news"] },
  keyword: { keyword: "rates" },
  // No read sends it: a meaning search runs in the browser, and the reads
  // that count or filter ignore it.
  ranking: { ranking: { kind: "meaning", query: "rates" } },
  respectsChannels: { respectsChannels: true },
  filter: { filter: filter("media:video") },
  maxPerChannel: { maxPerChannel: 0 },
  maxPerChannelMode: { maxPerChannelMode: "random" },
  sort: { sort: "oldest" },
  groupByChannel: { groupByChannel: true },
  viewMeasure: { viewMeasure: "views" },
  selection: {
    selection: [
      { kind: "pick", select: false, channelName: "news", postId: 1 },
    ],
    selectionRevision: 2,
  },
} satisfies Record<string, Partial<PostsView>>
type Field = keyof typeof changes

const shown: Field[] = [
  "channelNames",
  "keyword",
  "filter",
  "maxPerChannel",
  "maxPerChannelMode",
  "sort",
  "viewMeasure",
]

/** Each read, and the fields of the view it reads; it ignores the rest. */
const reads: [string, PostsRead, Field[]][] = [
  ["feed", { kind: "feed" }, [...shown, "groupByChannel", "selection"]],
  [
    "feed, selected first",
    { kind: "feed", selectedFirst: true },
    [...shown, "groupByChannel", "selection"],
  ],
  ["shown counts", { kind: "shownCounts" }, [...shown, "selection"]],
  ["Scope counts", { kind: "scopeCounts" }, ["scopeChannelNames", "selection"]],
  ["facets", { kind: "facets" }, ["channelNames", "selection"]],
  [
    "value histogram",
    { kind: "valueHistogram", measure: "views" },
    ["channelNames"],
  ],
  [
    "value histogram, filtered Channel posts, zoomed",
    {
      kind: "valueHistogram",
      measure: "channel_posts_filtered",
      zoom: { lo: 1, hi: 9, log: true },
    },
    ["channelNames", "keyword", "filter"],
  ],
  [
    "window histogram",
    {
      kind: "windowHistogram",
      query: { extentStart: 0, extentEnd: 9, buckets: 3, unfiltered: false },
    },
    ["channelNames", "keyword", "filter"],
  ],
  [
    "window histogram, unfiltered",
    {
      kind: "windowHistogram",
      query: { extentStart: 0, extentEnd: 9, buckets: 3, unfiltered: true },
    },
    ["scopeChannelNames"],
  ],
]

const moved = (a: PostsView, b: PostsView, read: PostsRead) => {
  const before = postsRead(a, read)
  const after = postsRead(b, read)
  return {
    key: JSON.stringify(before.queryKey) !== JSON.stringify(after.queryKey),
    body: JSON.stringify(before.body) !== JSON.stringify(after.body),
  }
}

describe("postsRead", () => {
  for (const [name, read, fields] of reads) {
    describe(name, () => {
      for (const field of Object.keys(changes) as Field[]) {
        // The selection is the one field whose key and body are different
        // values; its departure is asserted below.
        if (field === "selection") continue
        test(`${field} moves the key exactly when it moves the body`, () => {
          const m = moved(base, { ...base, ...changes[field] }, read)
          expect(m.body).toBe(fields.includes(field))
          expect(m.key).toBe(m.body)
        })
      }

      // The three departures: what the key holds instead of the body's value.

      test("the window by its key: a tick moves the body, not the key", () => {
        const m = moved(
          base,
          { ...base, startDate: 1_060_000, endDate: 2_060_000 },
          read,
        )
        expect(m).toEqual({ key: false, body: true })
        const k = moved(
          base,
          { ...base, windowKey: { mode: "fixed", start: 1, end: 2 } },
          read,
        )
        expect(k).toEqual({ key: true, body: false })
      })

      test("the Post selection by its revision, not its Picks", () => {
        const reads = fields.includes("selection")
        const picks = moved(
          base,
          { ...base, selection: changes.selection.selection },
          read,
        )
        expect(picks).toEqual({ key: false, body: reads })
        const revision = moved(base, { ...base, selectionRevision: 2 }, read)
        // The feed keys no revision at all: an edit patches or refetches the
        // loaded pages, where a new key would drop the Account to the top.
        const keyed = reads && read.kind !== "feed"
        expect(revision).toEqual({ key: keyed, body: false })
      })

      test("the Post filter by its printed text: fresh ids move the body only", () => {
        const m = moved(base, { ...base, filter: filter("lang:fa") }, read)
        expect(m).toEqual({ key: false, body: fields.includes("filter") })
      })
    })
  }

  test("a read's own inputs move both", () => {
    const pairs: [PostsRead, PostsRead][] = [
      [{ kind: "feed" }, { kind: "feed", selectedFirst: true }],
      [
        { kind: "valueHistogram", measure: "views" },
        { kind: "valueHistogram", measure: "estimated" },
      ],
      [
        { kind: "valueHistogram", measure: "views" },
        {
          kind: "valueHistogram",
          measure: "views",
          zoom: { lo: 1, hi: 2, log: false },
        },
      ],
      [
        {
          kind: "windowHistogram",
          query: {
            extentStart: 0,
            extentEnd: 9,
            buckets: 3,
            unfiltered: false,
          },
        },
        {
          kind: "windowHistogram",
          query: {
            extentStart: 0,
            extentEnd: 9,
            buckets: 4,
            unfiltered: false,
          },
        },
      ],
    ]
    for (const [a, b] of pairs) {
      const before = postsRead(base, a)
      const after = postsRead(base, b)
      expect(after.queryKey).not.toEqual(before.queryKey)
      expect(after.body).not.toEqual(before.body)
    }
  })
})

describe("scopeSubmission (PVM-02)", () => {
  // What every Action freezes: the Channels it names, the canonical window,
  // the order and the selection. Never the keyword, the Post filter, the cap
  // or the ranking, which decide what the tab shows (ADR-026).
  const view: PostsView = {
    ...base,
    keyword: "rates",
    ranking: { kind: "meaning", query: "rates" },
    filter: filter("media:video"),
    sort: "oldest",
    groupByChannel: true,
    viewMeasure: "views",
    windowKey: { mode: "live", durationMs: 3_600_000, endGapMs: 120_000 },
  }

  test("sends the Channels, the window, the order and the selection, field by field", () => {
    expect(scopeSubmission(view, ["news", "durov"])).toEqual({
      channels: ["news", "durov"],
      window: { mode: "live", durationMinutes: 60, endGapMinutes: 2 },
      viewMeasure: "views",
      sort: "oldest",
      groupByChannel: true,
      selection: [
        { kind: "pick", select: true, channelName: "news", postId: 1 },
      ],
    })
  })

  test("a Live window stays Live: the minute it resolves to is not sent", () => {
    const later = { ...view, startDate: 7_000_000, endDate: 8_000_000 }
    expect(scopeSubmission(later, ["news"]).window).toEqual({
      mode: "live",
      durationMinutes: 60,
      endGapMinutes: 2,
    })
  })

  test("a Fixed window is sent as its two ends", () => {
    const fixed: PostsView = {
      ...view,
      windowKey: { mode: "fixed", start: 5, end: 9 },
    }
    expect(scopeSubmission(fixed, ["news"]).window).toEqual({
      mode: "fixed",
      start: 5,
      end: 9,
    })
  })
})
