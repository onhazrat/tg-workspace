/**
 * The Ranking's fetch, a function of the Posts view and the api it calls
 * (PVM-02, PRM-01). Each test hands it a view literal and a fake api whose
 * every call throws unless the test expects it.
 */

import { describe, expect, test } from "bun:test"

import {
  addPostFunnel,
  emptyPostFilter,
  type PostFilter,
} from "@/lib/posts/post-filter"
import { applyPostViewPipeline } from "@/lib/posts/post-pipeline"
import {
  DEFAULT_SELECTION,
  type PostSelection,
  pick,
} from "@/lib/posts/post-selection"
import { NO_RANKING, type PostsView } from "@/lib/posts/posts-view"
import {
  fetchRanking,
  type RankingApi,
  rankingKey,
} from "@/lib/posts/scoped-posts"
import type { Post } from "@/types"

function makePost(
  channelName: string,
  id: number,
  timestamp: number,
  overrides: Partial<Post> = {},
): Post {
  return {
    id,
    channelName,
    text: `Post ${id} from ${channelName}`,
    date: new Date(timestamp).toISOString(),
    timestamp,
    ...overrides,
  }
}

const VIEW: PostsView = {
  scopeChannelNames: ["alpha", "beta"],
  channelNames: ["alpha", "beta"],
  keyword: "",
  ranking: NO_RANKING,
  respectsChannels: false,
  filter: emptyPostFilter(),
  maxPerChannel: 0,
  maxPerChannelMode: "ordered",
  sort: "newest",
  groupByChannel: false,
  viewMeasure: "estimated",
  startDate: 1000,
  endDate: 9000,
  windowKey: { mode: "live", durationMs: 8000, endGapMs: 0 },
  selection: DEFAULT_SELECTION,
  selectionRevision: 0,
}

/** The pipeline options `VIEW`'s order means, for the expected results. */
const PIPELINE = {
  maxPostsPerChannel: 0,
  maxPostsPerChannelMode: "ordered",
  postSortOrder: "newest",
  groupByChannel: false,
  viewMeasure: "estimated",
} as const

const meaning = (query: string): Partial<PostsView> => ({
  ranking: { kind: "meaning", query },
})

const persian = addPostFunnel(emptyPostFilter(), "language", "fa")

/** A curve at the default settings, as the server hands it over. */
const ESTIMATE = {
  curve: {
    points: [
      [1, 0.25],
      [24, 1],
    ],
  },
  settlingAgeHours: 24,
  estimationFloorHours: 3,
}

/** A Post as the lookup returns it, flagged by the Post selection (PTR-05). */
const flag = (p: Post): Post => ({ ...p, selected: true })

/** The server lookup under an empty filter: every ranked Post it was asked for, flagged. */
const flagged =
  (posts: Post[]): RankingApi["lookupPosts"] =>
  async (refs) =>
    posts
      .filter((p) =>
        refs.some((r) => r.channelName === p.channelName && r.postId === p.id),
      )
      .map(flag)

/** A fake api whose calls throw; individual tests override. */
function fakeApi(overrides: Partial<RankingApi> = {}): RankingApi {
  return {
    searchSimilarPosts: async () => {
      throw new Error("searchSimilarPosts should not be called")
    },
    lookupPosts: async () => {
      throw new Error("lookupPosts should not be called")
    },
    getViewEstimate: async () => ESTIMATE,
    ...overrides,
  }
}

const fetchShown = (over: Partial<PostsView>, api: RankingApi) =>
  fetchRanking({ ...VIEW, ...over }, api)

describe("fetchRanking: a meaning search", () => {
  test("respecting the Channels: bounded at 50, kept to them, the order applied", async () => {
    const ragResults = [makePost("alpha", 1, 100), makePost("beta", 2, 300)]
    const asked: unknown[] = []
    const result = await fetchShown(
      { ...meaning("  crypto  "), respectsChannels: true },
      fakeApi({
        searchSimilarPosts: async (query, limit, options) => {
          asked.push([query, limit, options])
          return ragResults
        },
        lookupPosts: flagged(ragResults),
      }),
    )

    expect(asked).toEqual([
      [
        "  crypto  ",
        50,
        { startDate: 1000, endDate: 9000, channels: ["alpha", "beta"] },
      ],
    ])
    // The order runs on the ranking, each Post flagged.
    expect(result).toEqual(
      applyPostViewPipeline(ragResults.map(flag), PIPELINE, {
        startDate: 1000,
        endDate: 9000,
      }),
    )
  })

  test("not respecting the Channels: the window is sent and the Channels are not", async () => {
    // The Channels are optional; the Analysis window is not (AW-01).
    let capturedOptions: unknown
    await fetchShown(
      meaning("crypto"),
      fakeApi({
        searchSimilarPosts: async (_q, _limit, options) => {
          capturedOptions = options
          return []
        },
      }),
    )

    expect(capturedOptions).toEqual({
      startDate: 1000,
      endDate: 9000,
      channels: undefined,
    })
  })

  test("the Post filter reaches the ranked Posts through the server (PTR-03)", async () => {
    const ranked = [
      makePost("alpha", 1, 100),
      makePost("alpha", 2, 200),
      makePost("beta", 3, 300),
      makePost("beta", 5, 50),
    ]
    const asked: { refs: unknown; filter: PostFilter; scope: unknown }[] = []
    const selection: PostSelection = [pick(false, ranked[3])]
    const result = await fetchShown(
      {
        ...meaning("crypto"),
        filter: persian,
        selection,
        sort: "oldest",
        groupByChannel: true,
      },
      fakeApi({
        searchSimilarPosts: async () => ranked,
        // The server answers in its own order; the ranking's set is kept.
        lookupPosts: async (refs, filter, scope) => {
          asked.push({ refs, filter, scope })
          return [{ ...ranked[3], selected: false }, flag(ranked[0])]
        },
      }),
    )

    expect(asked).toEqual([
      {
        refs: ranked.map((p) => ({ channelName: p.channelName, postId: p.id })),
        filter: persian,
        // Flagged by the selection, whose rules reach this window's Posts.
        scope: {
          channelNames: ["alpha", "beta"],
          startDate: 1000,
          endDate: 9000,
          selection,
        },
      },
    ])
    // What the filter showed, oldest first, beta's block first (its 50 leads),
    // each with the server's flag.
    expect(result.map((p) => `${p.channelName}/${p.id}/${p.selected}`)).toEqual(
      ["beta/5/false", "alpha/1/true"],
    )
  })

  test("a views order reads the server's curve (PFB-03)", async () => {
    const HOUR = 3_600_000
    const ranked = [
      // Settled at 5000, estimated from 2000 at 6h to 3663, too new at 1h.
      makePost("alpha", 1, 100, {
        viewsCount: 5000,
        viewsObservedAt: 100 + 48 * HOUR,
      }),
      makePost("alpha", 2, 200, {
        viewsCount: 2000,
        viewsObservedAt: 200 + 6 * HOUR,
      }),
      makePost("beta", 3, 300, {
        viewsCount: 9000,
        viewsObservedAt: 300 + HOUR,
      }),
    ]
    let asked = 0
    const run = (over: Partial<PostsView>) =>
      fetchShown(
        { ...meaning("crypto"), ...over },
        fakeApi({
          searchSimilarPosts: async () => ranked,
          lookupPosts: flagged(ranked),
          getViewEstimate: async () => {
            asked += 1
            return ESTIMATE
          },
        }),
      ).then((posts) => posts.map((p) => p.id))

    // The unjudged Post sorts last.
    expect(await run({ sort: "fewest_views" })).toEqual([2, 1, 3])
    expect(asked).toBe(1)
    // No views order: no curve is asked for.
    expect(await run({})).toEqual([3, 2, 1])
    // The raw measure never needs one either.
    expect(await run({ viewMeasure: "views", sort: "fewest_views" })).toEqual([
      2, 1, 3,
    ])
    expect(asked).toBe(1)
  })
})

describe("fetchRanking: a find-related", () => {
  test("excludes the Post it started from, bounded at 50, in the window", async () => {
    const seed = makePost("alpha", 1, 100)
    const ragResults = [
      seed,
      makePost("alpha", 1, 100), // same id+channel as seed → excluded
      makePost("beta", 2, 300),
    ]
    const asked: unknown[] = []
    const result = await fetchShown(
      { ranking: { kind: "related", post: seed }, respectsChannels: true },
      fakeApi({
        searchSimilarPosts: async (query, limit, options) => {
          asked.push([query, limit, options])
          return ragResults
        },
        lookupPosts: flagged(ragResults),
      }),
    )

    // "More like this" passed no options at all before AW-01, so it searched
    // every Post ever. It searches by the Post's text and never keeps to the
    // Channels.
    expect(asked).toEqual([
      ["Post 1 from alpha", 50, { startDate: 1000, endDate: 9000 }],
    ])
    expect(result).toEqual([flag(makePost("beta", 2, 300))])
  })
})

describe("rankingKey: what the fetch depends on (AW-04)", () => {
  /**
   * The feed's meaning search runs again when this moves, and only then. A
   * Live window resolves to a new pair every minute and a selection edit
   * reaches the ranked rows on its own, so neither may move it: a re-run
   * repeats the search, and a failed one ends the Account's search.
   */
  const key = (over: Partial<PostsView>) =>
    rankingKey({ ...VIEW, ...meaning("crypto"), ...over })

  test("a new minute does not move it", () => {
    expect(key({ startDate: 61_000, endDate: 69_000 })).toBe(key({}))
  })

  test("nor does a selection edit", () => {
    expect(
      key({
        selection: [pick(true, makePost("alpha", 1, 1))],
        selectionRevision: 1,
      }),
    ).toBe(key({}))
  })

  test("a new ranking, the Channels choice, the filter, the order or the window does", () => {
    const moves: Partial<PostsView>[] = [
      meaning("rates"),
      { ranking: { kind: "related", post: makePost("alpha", 2, 2) } },
      { respectsChannels: true },
      { scopeChannelNames: ["alpha"] },
      { keyword: "rates" },
      { filter: persian },
      { sort: "oldest" },
      { maxPerChannel: 3 },
      { windowKey: { mode: "live", durationMs: 3000, endGapMs: 0 } },
    ]
    for (const over of moves) expect(key(over)).not.toBe(key({}))
  })
})
