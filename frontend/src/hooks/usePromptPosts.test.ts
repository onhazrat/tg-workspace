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
import type { WindowState } from "@/lib/scope/window"
import type { Post } from "@/types"

/** One window identity, reused so a rerender is not a new window by accident. */
const LIVE_WINDOW: WindowState = {
  mode: "live",
  durationMs: 8000,
  endGapMs: 0,
}

function post(id: number): Post {
  return {
    id,
    channelName: "alpha",
    text: `post ${id}`,
    timestamp: id,
    date: "",
  } as Post
}

/*
 * Every default is a module constant rather than a fresh literal per call.
 *
 * `deps()` runs on every render, so a `new Set(...)` or an inline arrow here
 * would be a new identity each time and would defeat the memo the AW-04 block
 * below exists to check — the guard would fail against correct code and tell
 * you nothing about the dependency it is guarding. The real providers hand
 * these down from `useState`/`useCallback`, which is what this mirrors.
 */
const CHANNELS: PromptPostsDeps["channels"] = []
const SELECTED = new Set(["alpha"])
const VIEW_OPTIONS: PromptPostsDeps["postViewOptions"] = {
  maxPostsPerChannel: 0,
  maxPostsPerChannelMode: "latest",
  postSortOrder: "time",
}
const NO_SEARCH: PromptPostsDeps["searchSimilarPosts"] = async () => {
  throw new Error("searchSimilarPosts should not be called")
}
const NO_FEED: PromptPostsDeps["getPostsFeed"] = async () => {
  throw new Error("getPostsFeed should not be called")
}

function deps(over: Partial<PromptPostsDeps> = {}): PromptPostsDeps {
  return {
    channels: CHANNELS,
    selectedChannels: SELECTED,
    startDate: 1000,
    endDate: 9000,
    windowKey: LIVE_WINDOW,
    embeddingsEnabled: false,
    debouncedPostSearch: "",
    debouncedSemanticSearchQuery: "",
    relatedPostSearch: null,
    forwardedFilter: "all",
    mediaFilter: "all",
    postViewOptions: VIEW_OPTIONS,
    semanticSearchRespectsChannels: false,
    searchSimilarPosts: NO_SEARCH,
    getPostsFeed: NO_FEED,
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

describe("getScopedPosts keeps its identity while the minute moves (AW-04)", () => {
  /**
   * A Live window resolves to a new `[start, end)` pair every minute. This
   * callback used to be memoised on that pair, so its identity churned once a
   * minute — and `usePostsView` and `useEntityFlow` hold it in effect
   * dependencies. That re-ran the whole client vector path, in five mount
   * points, every 60 seconds; and a transient failure on that path clears the
   * Account's search rather than retrying it.
   *
   * So the memo is keyed on the *window*, and the boundaries are read when the
   * call happens. Both halves matter: a stable identity that also captured
   * stale boundaries would quietly keep fetching an older minute forever.
   */
  function renderWithDeps(initial: Partial<PromptPostsDeps>) {
    return renderHook(
      (over: Partial<PromptPostsDeps>) => usePromptPosts(deps(over)),
      { initialProps: initial },
    )
  }

  test("a new minute does not mint a new callback", () => {
    const { result, rerender } = renderWithDeps({})
    const first = result.current.getScopedPosts

    // What a tick looks like from here: the same window, boundaries a minute on.
    rerender({ startDate: 61_000, endDate: 69_000 })

    expect(result.current.getScopedPosts).toBe(first)
  })

  test("a new window does", () => {
    const { result, rerender } = renderWithDeps({})
    const first = result.current.getScopedPosts

    rerender({
      windowKey: { mode: "live", durationMs: 3000, endGapMs: 0 },
      startDate: 6000,
      endDate: 9000,
    })

    expect(result.current.getScopedPosts).not.toBe(first)
  })

  test("the call still fetches the minute it happens in", async () => {
    const asked: { startDate?: number; endDate?: number }[] = []
    const feed = (async (params: { startDate?: number; endDate?: number }) => {
      asked.push(params)
      return []
    }) as unknown as PromptPostsDeps["getPostsFeed"]

    const { result, rerender } = renderWithDeps({ getPostsFeed: feed })
    rerender({ getPostsFeed: feed, startDate: 61_000, endDate: 69_000 })
    await result.current.getScopedPosts()

    expect(asked.at(-1)?.startDate).toBe(61_000)
    expect(asked.at(-1)?.endDate).toBe(69_000)
  })
})
