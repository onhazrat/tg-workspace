import { describe, expect, test } from "bun:test"

import type { Post } from "@/types"
import { type PostFilter, parsePostFilter } from "./post-filter"
import {
  feedQuery,
  isRanked,
  NO_RANKING,
  PICK_POOL_LIMIT,
  type PostsRanking,
  type PostsRead,
  type PostsView,
  postsQuery,
  postsRead,
  rankingQuery,
  scopeSubmission,
  servedBy,
  withSemanticSearch,
} from "./posts-view"
import type { RankingApi } from "./scoped-posts"
import { EXPORT_LIMIT } from "./selected-export"

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
  [
    "pick-post list",
    { kind: "pickPool" },
    [...shown, "groupByChannel", "selection"],
  ],
  [
    "selected shown Posts",
    { kind: "selectedShown" },
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
        // The pick-post list lists Posts, whichever are selected.
        const keyed = reads && read.kind !== "feed" && read.kind !== "pickPool"
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

describe("the two reads built from the feed's body (PRM-01)", () => {
  test("the pick-post list is the feed's first 100", () => {
    expect(postsRead(base, { kind: "pickPool" }).body).toEqual({
      ...postsRead(base, { kind: "feed" }).body,
      limit: PICK_POOL_LIMIT,
    })
    expect(PICK_POOL_LIMIT).toBe(100)
  })

  test("the selected shown Posts are the feed's selected ones, to the export limit", () => {
    expect(postsRead(base, { kind: "selectedShown" }).body).toEqual({
      ...postsRead(base, { kind: "feed" }).body,
      onlySelected: true,
      limit: EXPORT_LIMIT,
    })
  })
})

describe("which source serves each read (PRM-01)", () => {
  /**
   * The table that would have caught the find-related bug: the shown counts
   * asked the server during a find-related, because one hook decided "ranked"
   * by the meaning query alone. Every read asks `servedBy`, and every server
   * query is off exactly when the Ranking serves its read.
   */
  const related: Post = {
    id: 7,
    channelName: "news",
    text: "rates rise",
    date: "2026-10-28T00:00:00Z",
    timestamp: 1_500_000,
  }
  const rankings: Record<string, PostsRanking> = {
    none: NO_RANKING,
    meaning: { kind: "meaning", query: "rates" },
    related: { kind: "related", post: related },
  }
  const selections: Record<string, Partial<PostsView>> = {
    empty: { selection: [], selectionRevision: 4 },
    some: { selection: base.selection, selectionRevision: 5 },
  }
  const everyRead: PostsRead[] = [
    { kind: "feed" },
    { kind: "shownCounts" },
    { kind: "scopeCounts" },
    { kind: "facets" },
    { kind: "valueHistogram", measure: "views" },
    {
      kind: "windowHistogram",
      query: { extentStart: 0, extentEnd: 9, buckets: 3, unfiltered: true },
    },
    { kind: "pickPool" },
    { kind: "selectedShown" },
  ]
  // What the tab shows and its count; nothing that only counts or filters.
  const reached = new Set(["feed", "shownCounts", "pickPool", "selectedShown"])
  const api: RankingApi = {
    searchSimilarPosts: async () => [],
    lookupPosts: async () => [],
    getViewEstimate: async () => {
      throw new Error("not read")
    },
  }

  for (const [rankingName, ranking] of Object.entries(rankings))
    for (const semanticSearch of [true, false])
      for (const [selectionName, selection] of Object.entries(selections))
        test(`${rankingName}, Semantic search ${semanticSearch ? "on" : "off"}, selection ${selectionName}`, () => {
          const view: PostsView = {
            ...base,
            ...selection,
            ranking: withSemanticSearch(ranking, semanticSearch),
          }
          const ranked = rankingName !== "none" && semanticSearch
          expect(isRanked(view)).toBe(ranked)

          for (const read of everyRead) {
            const by = ranked && reached.has(read.kind) ? "ranking" : "server"
            expect([read.kind, servedBy(view, read)]).toEqual([read.kind, by])
            const enabled =
              read.kind === "feed"
                ? feedQuery(view, false).enabled
                : postsQuery(view, read).enabled
            expect([read.kind, enabled]).toEqual([read.kind, by === "server"])
          }

          const search = rankingQuery(view, api)
          expect(search.enabled).toBe(ranked)
          expect(search.retry).toBe(false)
          // One cache entry for every read the Ranking serves, whatever the
          // selection and the minute: neither runs the search again.
          const other = { ...view, ...selections.some, selectionRevision: 9 }
          const tick = { ...view, startDate: 1_060_000, endDate: 2_060_000 }
          expect(rankingQuery(other, api).queryKey).toEqual(search.queryKey)
          expect(rankingQuery(tick, api).queryKey).toEqual(search.queryKey)
        })

  test("no Channels selected: no server read runs", () => {
    const view = { ...base, scopeChannelNames: [], channelNames: [] }
    for (const read of everyRead)
      if (read.kind !== "feed")
        expect([read.kind, postsQuery(view, read).enabled]).toEqual([
          read.kind,
          false,
        ])
  })
})

describe("the Scope counts read, which the no-Posts-selected check fetches (PVM-02)", () => {
  // The Scope's Channels, the window and the selection, and nothing a count
  // ignores: no Post filter, keyword, cap, order, grouping or views measure.
  test("its key and body", () => {
    const view: PostsView = {
      ...base,
      channelNames: ["news"],
      keyword: "rates",
      sort: "oldest",
      groupByChannel: true,
      viewMeasure: "views",
    }
    expect(postsRead(view, { kind: "scopeCounts" })).toEqual({
      queryKey: [
        "postsCounts",
        {
          channelNames: ["durov", "news"],
          window: { mode: "live", durationMs: 1_000_000, endGapMs: 0 },
          selection: 1,
        },
      ],
      body: {
        channelNames: ["durov", "news"],
        // The pair the window resolves to now, to the minute.
        window: { mode: "fixed", start: 960_000, end: 1_980_000 },
        selection: [
          { kind: "pick", select: true, channelName: "news", postId: 1 },
        ],
      },
    })
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
