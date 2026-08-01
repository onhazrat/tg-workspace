import { describe, expect, test } from "bun:test"

import type { PostFeedQuery } from "@/api/data"
import {
  applyForwardedFilter,
  applyPostViewPipeline,
  type PostViewOptions,
} from "@/lib/posts/post-view"
import {
  computeScopedPosts,
  SCOPED_POSTS_LIMIT,
  type ScopedPostsDeps,
} from "@/lib/posts/scoped-posts"
import type { Channel, Post } from "@/types"

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

function makeChannel(name: string): Channel {
  return {
    id: name,
    name,
    displayName: name,
    startTime: 0,
    lastUpdated: 0,
    followedAt: 0,
    tags: [],
    isFrozen: false,
    isUnavailableOnWebView: false,
    autoFollowForwarded: false,
    regularSyncEnabled: true,
    dynamicSyncEnabled: false,
  }
}

const view: PostViewOptions = {
  maxPostsPerChannel: 0,
  maxPostsPerChannelMode: "latest",
  postSortOrder: "time",
}

const channels = [makeChannel("alpha"), makeChannel("beta")]

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
    forwardedFilter: "all",
    mediaFilter: "all",
    channels,
    postViewOptions: view,
    semanticSearchRespectsTimeRange: false,
    semanticSearchRespectsChannels: false,
    searchSimilarPosts: async () => {
      throw new Error("searchSimilarPosts should not be called")
    },
    getPostsFeed: async () => {
      throw new Error("getPostsFeed should not be called")
    },
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
      forwardedFilter: "unfollowed_forwarded",
      mediaFilter: "photo",
      postViewOptions: {
        maxPostsPerChannel: 7,
        maxPostsPerChannelMode: "random",
        postSortOrder: "channel_time",
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
        forwarded: "unfollowed_forwarded",
        media: "photo",
        maxPerChannel: 7,
        maxPerChannelMode: "random",
        sort: "channel_time",
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
    const ragResults = [
      makePost("alpha", 1, 100, { forwardedFrom: "somewhere" }),
      makePost("beta", 2, 300),
    ]
    let capturedLimit: number | undefined
    let capturedOptions: unknown
    const deps = baseDeps({
      embeddingsEnabled: true,
      semanticQuery: "  crypto  ",
      forwardedFilter: "original",
      semanticSearchRespectsTimeRange: true,
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
    // "original" drops the forwarded post, then the view pipeline runs.
    expect(result).toEqual(
      applyPostViewPipeline(
        applyForwardedFilter(ragResults, "original", channels),
        view,
        { startDate: 1000, endDate: 9000 },
      ),
    )
  })

  test("semantic path: respects-flags off omit RAG scoping options", async () => {
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
      startDate: undefined,
      endDate: undefined,
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
    const deps = baseDeps({
      embeddingsEnabled: true,
      relatedPostSearch: seed,
      searchSimilarPosts: async (_q, limit) => {
        capturedLimit = limit
        return ragResults
      },
    })

    const result = await computeScopedPosts(deps)

    expect(capturedLimit).toBe(50)
    const expected = ragResults.filter(
      (p) => p.id !== seed.id || p.channelName !== seed.channelName,
    )
    expect(result).toEqual(
      applyPostViewPipeline(
        applyForwardedFilter(expected, "all", channels),
        view,
        {
          startDate: 1000,
          endDate: 9000,
        },
      ),
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
