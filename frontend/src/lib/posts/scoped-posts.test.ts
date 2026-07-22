import { describe, expect, test } from "bun:test"

import {
  applyForwardedFilter,
  applyPostViewPipeline,
  buildFilteredPostsFromRaw,
  type PostViewOptions,
} from "@/lib/posts/post-view"
import {
  computeScopedPosts,
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
    getPostsByDateRange: async () => {
      throw new Error("getPostsByDateRange should not be called")
    },
    ...overrides,
  }
}

describe("computeScopedPosts", () => {
  test("normal path: matches buildFilteredPostsFromRaw for the same inputs", async () => {
    const raw = [
      makePost("alpha", 1, 100),
      makePost("beta", 2, 300),
      makePost("alpha", 3, 200),
    ]
    const calls: unknown[][] = []
    const deps = baseDeps({
      searchText: "Post",
      forwardedFilter: "all",
      mediaFilter: "all",
      getPostsByDateRange: async (...args) => {
        calls.push(args)
        return raw
      },
    })

    const result = await computeScopedPosts(deps)

    // Byte-for-byte the eager path's output.
    expect(result).toEqual(
      buildFilteredPostsFromRaw(raw, {
        searchText: "Post",
        forwardedFilter: "all",
        mediaFilter: "all",
        channels,
        view,
        startDate: 1000,
        endDate: 9000,
      }),
    )
    // Fetched exactly the selected channels + date range.
    expect(calls).toEqual([[["alpha", "beta"], 1000, 9000]])
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
    const raw = [makePost("alpha", 1, 100)]
    let ragCalled = false
    const deps = baseDeps({
      embeddingsEnabled: false,
      semanticQuery: "crypto",
      searchSimilarPosts: async () => {
        ragCalled = true
        return []
      },
      getPostsByDateRange: async () => raw,
    })

    const result = await computeScopedPosts(deps)

    expect(ragCalled).toBe(false)
    expect(result).toEqual(
      buildFilteredPostsFromRaw(raw, {
        searchText: "",
        forwardedFilter: "all",
        mediaFilter: "all",
        channels,
        view,
        startDate: 1000,
        endDate: 9000,
      }),
    )
  })
})
