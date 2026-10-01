import { describe, expect, test } from "bun:test"

import type { PostFeedQuery } from "@/api/data"
import {
  addPostFunnel,
  emptyPostFilter,
  type PostFilter,
} from "@/lib/posts/post-filter"
import {
  applyPostViewPipeline,
  type PostViewOptions,
} from "@/lib/posts/post-view"
import {
  computeScopedPosts,
  SCOPED_POSTS_LIMIT,
  type ScopedPostsDeps,
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

const view: PostViewOptions = {
  maxPostsPerChannel: 0,
  maxPostsPerChannelMode: "ordered",
  postSortOrder: "newest",
  groupByChannel: false,
  viewMeasure: "estimated" as const,
}

const persian = addPostFunnel(emptyPostFilter(), "language", "fa")

/** The seed curve at the default settings, as the server hands it over. */
const SEED_ESTIMATE = {
  curve: {
    kind: "steps" as const,
    points: [
      [0, 0.2],
      [3, 0.59],
      [6, 0.7],
      [12, 0.86],
      [24, 0.89],
    ],
  },
  settlingAgeHours: 24,
  estimationFloorHours: 3,
}

/** A deps object with inert RAG/repository fns; individual tests override. */
function baseDeps(overrides: Partial<ScopedPostsDeps> = {}): ScopedPostsDeps {
  return {
    searchText: "",
    semanticQuery: "",
    relatedPostSearch: null,
    embeddingsEnabled: false,
    selectedChannels: ["alpha", "beta"],
    startDate: 1000,
    endDate: 9000,
    postFilter: emptyPostFilter(),
    postViewOptions: view,
    semanticSearchRespectsChannels: false,
    searchSimilarPosts: async () => {
      throw new Error("searchSimilarPosts should not be called")
    },
    getPostsFeed: async () => {
      throw new Error("getPostsFeed should not be called")
    },
    lookupPosts: async () => {
      throw new Error("lookupPosts should not be called")
    },
    getViewEstimate: async () => SEED_ESTIMATE,
    ...overrides,
  }
}

describe("computeScopedPosts", () => {
  /**
   * The normal path no longer filters anything client-side (A1c) — it hands the
   * scope to `POST /data/posts` and returns what comes back. So what these
   * tests can still guarantee is the *translation*: that every piece of filter
   * state reaches the server, under the right name, unmodified.
   *
   * The filtering itself is pinned server-side, where it now happens:
   * `app/services/post_filters.py` documents the per-filter parity targets and
   * `tests/api/test_posts_feed.py` exercises them.
   */
  test("normal path: hands the whole filter state to the server feed", async () => {
    const fromServer = [makePost("alpha", 1, 100)]
    const calls: PostFeedQuery[] = []
    const deps = baseDeps({
      searchText: "Post",
      postFilter: persian,
      postViewOptions: {
        maxPostsPerChannel: 7,
        maxPostsPerChannelMode: "random",
        postSortOrder: "most_views",
        groupByChannel: true,
        viewMeasure: "views" as const,
      },
      getPostsFeed: async (query) => {
        calls.push(query)
        return fromServer
      },
    })

    const result = await computeScopedPosts(deps)

    // Returned verbatim — no client-side post-processing survives.
    expect(result).toBe(fromServer)
    expect(calls).toEqual([
      {
        channelNames: ["alpha", "beta"],
        startDate: 1000,
        endDate: 9000,
        keyword: "Post",
        filter: persian,
        viewMeasure: "views",
        maxPerChannel: 7,
        maxPerChannelMode: "random",
        sort: "most_views",
        groupByChannel: true,
        seed: 0,
        limit: SCOPED_POSTS_LIMIT,
      },
    ])
  })

  test("normal path: the read is bounded", async () => {
    // The point of A1c. This branch used to page a channel's whole history
    // into the browser; a regression to an unbounded read would not change any
    // other assertion here, so it gets its own.
    let capturedLimit: number | undefined
    const deps = baseDeps({
      getPostsFeed: async (query) => {
        capturedLimit = query.limit
        return []
      },
    })

    await computeScopedPosts(deps)

    expect(capturedLimit).toBe(SCOPED_POSTS_LIMIT)
    expect(SCOPED_POSTS_LIMIT).toBeLessThanOrEqual(5000)
  })

  test("semantic path: bounded at 50, RAG options honoured, view pipeline applied", async () => {
    const ragResults = [makePost("alpha", 1, 100), makePost("beta", 2, 300)]
    let capturedLimit: number | undefined
    let capturedOptions: unknown
    const deps = baseDeps({
      embeddingsEnabled: true,
      semanticQuery: "  crypto  ",
      semanticSearchRespectsChannels: true,
      searchSimilarPosts: async (_q, limit, options) => {
        capturedLimit = limit
        capturedOptions = options
        return ragResults
      },
    })

    const result = await computeScopedPosts(deps)

    expect(capturedLimit).toBe(50)
    expect(capturedOptions).toEqual({
      startDate: 1000,
      endDate: 9000,
      channels: ["alpha", "beta"],
    })
    // No Post filter, so no lookup: the view pipeline runs on the ranking.
    expect(result).toEqual(
      applyPostViewPipeline(ragResults, view, {
        startDate: 1000,
        endDate: 9000,
      }),
    )
  })

  test("semantic path: the Post filter reaches the ranked Posts through the server (PTR-03)", async () => {
    const ranked = [
      makePost("alpha", 1, 100),
      makePost("alpha", 2, 200),
      makePost("beta", 3, 300),
      makePost("beta", 5, 50),
    ]
    const asked: { refs: unknown; filter: PostFilter }[] = []
    const result = await computeScopedPosts(
      baseDeps({
        embeddingsEnabled: true,
        semanticQuery: "crypto",
        postFilter: persian,
        postViewOptions: {
          ...view,
          postSortOrder: "oldest",
          groupByChannel: true,
        },
        searchSimilarPosts: async () => ranked,
        // The server answers in its own order; the ranking's set is kept.
        lookupPosts: async (refs, filter) => {
          asked.push({ refs, filter })
          return [ranked[3], ranked[0]]
        },
      }),
    )

    expect(asked).toEqual([
      {
        refs: ranked.map((p) => ({ channelName: p.channelName, postId: p.id })),
        filter: persian,
      },
    ])
    // What the filter showed, oldest first, beta's block first (its 50 leads).
    expect(result.map((p) => `${p.channelName}/${p.id}`)).toEqual([
      "beta/5",
      "alpha/1",
    ])
  })

  test("semantic path: a views order reads the server's curve (PFB-03)", async () => {
    const HOUR = 3_600_000
    const ranked = [
      // Settled at 5000, estimated from 2000 at 6h to 2543, too new at 1h.
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
    const run = (over: Partial<typeof view>) =>
      computeScopedPosts(
        baseDeps({
          embeddingsEnabled: true,
          semanticQuery: "crypto",
          postViewOptions: { ...view, ...over },
          searchSimilarPosts: async () => ranked,
          getViewEstimate: async () => {
            asked += 1
            return SEED_ESTIMATE
          },
        }),
      ).then((posts) => posts.map((p) => p.id))

    // The unjudged Post sorts last.
    expect(await run({ postSortOrder: "fewest_views" })).toEqual([2, 1, 3])
    expect(asked).toBe(1)
    // No views order: no curve is asked for.
    expect(await run({})).toEqual([3, 2, 1])
    // The raw measure never needs one either.
    expect(
      await run({ viewMeasure: "views", postSortOrder: "fewest_views" }),
    ).toEqual([2, 1, 3])
    expect(asked).toBe(1)
  })

  test("semantic path: the window is sent even when channels are not", async () => {
    /**
     * The channel scoping is still optional; the Analysis window is not
     * (AW-01). This test used to assert the opposite — that both bounds were
     * omitted — which was the control that let one Posts path mean all time
     * while the rest of Scope meant a window.
     */
    let capturedOptions: unknown
    const deps = baseDeps({
      embeddingsEnabled: true,
      semanticQuery: "crypto",
      searchSimilarPosts: async (_q, _limit, options) => {
        capturedOptions = options
        return []
      },
    })

    await computeScopedPosts(deps)

    expect(capturedOptions).toEqual({
      startDate: 1000,
      endDate: 9000,
      channels: undefined,
    })
  })

  test("related path: excludes the seed post, bounded at 50", async () => {
    const seed = makePost("alpha", 1, 100)
    const ragResults = [
      seed,
      makePost("alpha", 1, 100), // same id+channel as seed → excluded
      makePost("beta", 2, 300),
    ]
    let capturedLimit: number | undefined
    let capturedOptions: unknown
    const deps = baseDeps({
      embeddingsEnabled: true,
      relatedPostSearch: seed,
      searchSimilarPosts: async (_q, limit, options) => {
        capturedLimit = limit
        capturedOptions = options
        return ragResults
      },
    })

    const result = await computeScopedPosts(deps)

    expect(capturedLimit).toBe(50)
    // "More like this" passed no options at all before AW-01, so it searched
    // every Post ever — the same defect as the removed ignore-window control,
    // with nothing on screen admitting to it.
    expect(capturedOptions).toEqual({ startDate: 1000, endDate: 9000 })
    const expected = ragResults.filter(
      (p) => p.id !== seed.id || p.channelName !== seed.channelName,
    )
    expect(result).toEqual(
      applyPostViewPipeline(expected, view, {
        startDate: 1000,
        endDate: 9000,
      }),
    )
  })

  test("embeddings off: semantic query falls through to the normal path", async () => {
    const fromServer = [makePost("alpha", 1, 100)]
    let ragCalled = false
    const deps = baseDeps({
      embeddingsEnabled: false,
      semanticQuery: "crypto",
      searchSimilarPosts: async () => {
        ragCalled = true
        return []
      },
      getPostsFeed: async () => fromServer,
    })

    const result = await computeScopedPosts(deps)

    expect(ragCalled).toBe(false)
    expect(result).toBe(fromServer)
  })

  test("the semantic branches never touch the server feed", async () => {
    // Semantic ranking is the one selection the server cannot derive from a
    // scope, so those branches must stay on the RAG path. `baseDeps` throws
    // from `getPostsFeed`, which is what makes this assertion real.
    const deps = baseDeps({
      embeddingsEnabled: true,
      semanticQuery: "crypto",
      searchSimilarPosts: async () => [makePost("alpha", 1, 100)],
    })

    expect((await computeScopedPosts(deps)).length).toBe(1)
  })
})
