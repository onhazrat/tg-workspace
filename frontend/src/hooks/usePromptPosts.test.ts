/**
 * Which posts input an AI prompt gets (G1, PTR-05).
 *
 * Always a scope carrying the Post selection, which the backend resolves and
 * assembles, so nothing crosses the wire. A meaning search used to send its
 * ranked Posts instead; since PTR-05 it reaches an Action as the Picks its
 * "Select all" records, and the prompt covers the whole selection whatever
 * the tab shows.
 *
 * Testable without `mock.module` — which is process-wide in Bun and would
 * contaminate every file importing `@/api` — because every dependency is
 * injected. That is why `usePromptPosts` takes a deps object.
 */

import { describe, expect, test } from "bun:test"
import { renderHook } from "@testing-library/react"

import { type PromptPostsDeps, usePromptPosts } from "@/hooks/usePromptPosts"
import { addPostFunnel, emptyPostFilter } from "@/lib/posts/post-filter"
import {
  DEFAULT_SELECTION,
  EMPTY_SNAPSHOT,
  pick,
  rule,
} from "@/lib/posts/post-selection"
import { NO_RANKING, type PostsView } from "@/lib/posts/posts-view"
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
 * `deps()` runs on every render, so a fresh array or arrow here would be a
 * new identity each time and fake a changed view. The provider hands these
 * down from state and memos, which is what this mirrors.
 */
const CHANNELS = ["alpha"]
// A constant for the same reason: the provider parses the tree in a memo.
const NO_FILTER = emptyPostFilter()
const PERSIAN = addPostFunnel(emptyPostFilter(), "language", "fa")
const SELECTION = [
  rule(true),
  rule(false, { ...EMPTY_SNAPSHOT, tree: PERSIAN }),
  pick(true, post(1)),
]
const NO_SEARCH: PromptPostsDeps["searchSimilarPosts"] = async () => {
  throw new Error("searchSimilarPosts should not be called")
}
const NO_FEED: PromptPostsDeps["getPostsFeed"] = async () => {
  throw new Error("getPostsFeed should not be called")
}

const NO_LOOKUP: PromptPostsDeps["lookupPosts"] = async () => {
  throw new Error("lookupPosts should not be called")
}

const NO_ESTIMATE: PromptPostsDeps["getViewEstimate"] = async () => {
  throw new Error("getViewEstimate should not be called")
}

const VIEW: PostsView = {
  scopeChannelNames: CHANNELS,
  channelNames: CHANNELS,
  keyword: "",
  ranking: NO_RANKING,
  respectsChannels: false,
  filter: NO_FILTER,
  maxPerChannel: 0,
  maxPerChannelMode: "ordered",
  sort: "newest",
  groupByChannel: false,
  viewMeasure: "estimated",
  startDate: 1000,
  endDate: 9000,
  windowKey: LIVE_WINDOW,
  selection: DEFAULT_SELECTION,
  selectionRevision: 0,
}

type Over = Partial<PostsView> & Partial<Omit<PromptPostsDeps, "view">>

function deps(over: Over = {}): PromptPostsDeps {
  const {
    embeddingsEnabled = false,
    searchSimilarPosts = NO_SEARCH,
    getPostsFeed = NO_FEED,
    lookupPosts = NO_LOOKUP,
    getViewEstimate = NO_ESTIMATE,
    ...view
  } = over
  // A new view object every render, as the provider's memo makes one per
  // change: what must hold still is decided by the fields, not the object.
  return {
    view: { ...VIEW, ...view },
    embeddingsEnabled,
    searchSimilarPosts,
    getPostsFeed,
    lookupPosts,
    getViewEstimate,
  }
}

function render(over: Over = {}) {
  return renderHook(() => usePromptPosts(deps(over))).result.current
}

describe("getPromptPostsInput", () => {
  test("sends a scope and fetches nothing", async () => {
    // Every injected fetcher throws, so reaching one fails the test.
    const input = await render().getPromptPostsInput()

    expect(input.scope).toBeDefined()
  })

  test("the scope carries the selection and the order, never the Post filter", async () => {
    // ADR-026: the Post filter, the keyword and the cap decide what the tab
    // shows. A Summary covers the Post selection whatever they say.
    const input = await render({
      keyword: "crypto",
      filter: PERSIAN,
      selection: SELECTION,
      maxPerChannel: 7,
      maxPerChannelMode: "random",
      sort: "most_views",
      groupByChannel: true,
      viewMeasure: "views",
    }).getPromptPostsInput()

    expect(input.scope).toEqual({
      startDate: 1000,
      endDate: 9000,
      selection: SELECTION,
      viewMeasure: "views",
      sort: "most_views",
      groupByChannel: true,
    })
  })

  test("a meaning search is not a prompt input: the selection is", async () => {
    // Its ranked Posts never reach a prompt directly; the search runs only
    // for what the tab shows.
    const input = await render({
      embeddingsEnabled: true,
      ranking: { kind: "related", post: post(1) },
      selection: SELECTION,
    }).getPromptPostsInput()

    expect(input.scope.selection).toBe(SELECTION)
  })

  test("the tab's ranked Posts come back flagged by the selection", async () => {
    const ranked = [post(1), post(2)]
    const looked: unknown[] = []
    const shown = await render({
      embeddingsEnabled: true,
      ranking: { kind: "meaning", query: "crypto" },
      filter: PERSIAN,
      selection: SELECTION,
      searchSimilarPosts: async () => ranked,
      lookupPosts: async (_refs, filter, scope) => {
        looked.push([filter, scope.selection])
        return [{ ...ranked[1], selected: false }]
      },
    }).getScopedPosts()

    expect(shown.map((p) => [p.id, p.selected])).toEqual([[2, false]])
    expect(looked).toEqual([[PERSIAN, SELECTION]])
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
  function renderWithDeps(initial: Over) {
    return renderHook((over: Over) => usePromptPosts(deps(over)), {
      initialProps: initial,
    })
  }

  test("a new minute does not mint a new callback", () => {
    const { result, rerender } = renderWithDeps({})
    const first = result.current.getScopedPosts

    // What a tick looks like from here: the same window, boundaries a minute on.
    rerender({ startDate: 61_000, endDate: 69_000 })

    expect(result.current.getScopedPosts).toBe(first)
  })

  test("nor does a selection edit, which a meaning search must not re-run for", () => {
    const { result, rerender } = renderWithDeps({})
    const first = result.current.getScopedPosts

    rerender({ selection: SELECTION, selectionRevision: 1 })

    expect(result.current.getScopedPosts).toBe(first)
  })

  test("a new ranking does", () => {
    const { result, rerender } = renderWithDeps({})
    const first = result.current.getScopedPosts

    rerender({ ranking: { kind: "related", post: post(2) } })

    expect(result.current.getScopedPosts).not.toBe(first)
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
