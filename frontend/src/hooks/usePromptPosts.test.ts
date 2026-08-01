/**
 * Which posts input an AI prompt gets (G1).
 *
 * `getPromptPostsInput` makes one decision, and it is the load-bearing one in
 * the whole prompt path: **scope or posts**. Send a scope and the backend
 * assembles the block, so nothing crosses the wire; send posts and the caller
 * formats them itself. Choose wrong in the "scope" direction and a semantic
 * search silently summarises the *unranked* corpus instead of the matches.
 *
 * Testable without `mock.module` — which is process-wide in Bun and would
 * contaminate every file importing `@/api` — because every dependency is
 * injected. That is why `usePromptPosts` takes a deps object.
 */

import { describe, expect, test } from "bun:test"
import { renderHook } from "@testing-library/react"

import { type PromptPostsDeps, usePromptPosts } from "@/hooks/usePromptPosts"
import type { Post } from "@/types"

function post(id: number): Post {
  return {
    id,
    channelName: "alpha",
    text: `post ${id}`,
    timestamp: id,
    date: "",
  } as Post
}

function deps(over: Partial<PromptPostsDeps> = {}): PromptPostsDeps {
  return {
    channels: [],
    selectedChannels: new Set(["alpha"]),
    startDate: 1000,
    endDate: 9000,
    embeddingsEnabled: false,
    debouncedPostSearch: "",
    debouncedSemanticSearchQuery: "",
    relatedPostSearch: null,
    forwardedFilter: "all",
    mediaFilter: "all",
    postViewOptions: {
      maxPostsPerChannel: 0,
      maxPostsPerChannelMode: "latest",
      postSortOrder: "time",
    },
    semanticSearchRespectsTimeRange: false,
    semanticSearchRespectsChannels: false,
    searchSimilarPosts: async () => {
      throw new Error("searchSimilarPosts should not be called")
    },
    getPostsFeed: async () => {
      throw new Error("getPostsFeed should not be called")
    },
    ...over,
  }
}

function render(over: Partial<PromptPostsDeps> = {}) {
  return renderHook(() => usePromptPosts(deps(over))).result.current
}

describe("getPromptPostsInput", () => {
  test("the ordinary path sends a scope and fetches nothing", async () => {
    // Both injected fetchers throw, so reaching either fails the test.
    const input = await render().getPromptPostsInput()

    expect(input.posts).toBeUndefined()
    expect(input.scope).toBeDefined()
  })

  test("the scope carries the whole filter state", async () => {
    const input = await render({
      debouncedPostSearch: "crypto",
      forwardedFilter: "unfollowed_forwarded",
      mediaFilter: "photo",
      postViewOptions: {
        maxPostsPerChannel: 7,
        maxPostsPerChannelMode: "random",
        postSortOrder: "channel_time",
      },
    }).getPromptPostsInput()

    expect(input.scope).toEqual({
      startDate: 1000,
      endDate: 9000,
      keyword: "crypto",
      forwarded: "unfollowed_forwarded",
      media: "photo",
      maxPerChannel: 7,
      maxPerChannelMode: "random",
      sort: "channel_time",
      seed: 0,
    })
  })

  test("a semantic query returns posts, not a scope", async () => {
    // The direction that matters: a scope here would summarise the unranked
    // corpus, silently ignoring what the user searched for.
    const input = await render({
      embeddingsEnabled: true,
      debouncedSemanticSearchQuery: "crypto",
      searchSimilarPosts: async () => [post(1), post(2)],
    }).getPromptPostsInput()

    expect(input.scope).toBeUndefined()
    expect(input.posts?.length).toBe(2)
  })

  test("a related-post search returns posts, not a scope", async () => {
    const seed = post(1)
    const input = await render({
      embeddingsEnabled: true,
      relatedPostSearch: seed,
      searchSimilarPosts: async () => [seed, post(2)],
    }).getPromptPostsInput()

    expect(input.scope).toBeUndefined()
    expect(input.posts?.map((p) => p.id)).toEqual([2])
  })

  test("embeddings off keeps the scope path even with a semantic query", async () => {
    // Otherwise turning embeddings off would break summarising entirely.
    const input = await render({
      embeddingsEnabled: false,
      debouncedSemanticSearchQuery: "crypto",
      relatedPostSearch: post(1),
    }).getPromptPostsInput()

    expect(input.scope).toBeDefined()
  })

  test("a whitespace-only semantic query is not a semantic search", async () => {
    const input = await render({
      embeddingsEnabled: true,
      debouncedSemanticSearchQuery: "   ",
    }).getPromptPostsInput()

    expect(input.scope).toBeDefined()
  })

  test("a keyword search stays on the scope path", async () => {
    // Keyword filtering is reproducible in SQL; only vector ranking is not.
    const input = await render({
      embeddingsEnabled: true,
      debouncedPostSearch: "crypto",
    }).getPromptPostsInput()

    expect(input.scope?.keyword).toBe("crypto")
    expect(input.posts).toBeUndefined()
  })
})
