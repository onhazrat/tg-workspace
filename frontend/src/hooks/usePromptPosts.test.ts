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
  selectionBody,
} from "@/lib/posts/post-selection"
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
const SELECTED = new Set(["alpha"])
const VIEW_OPTIONS: PromptPostsDeps["postViewOptions"] = {
  maxPostsPerChannel: 0,
  maxPostsPerChannelMode: "ordered",
  postSortOrder: "newest",
  groupByChannel: false,
  viewMeasure: "estimated" as const,
}
// A constant for the reason `VIEW_OPTIONS` is one: the provider hands the tree
// down from a memo, so a fresh one per render would fake a changed filter.
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

function deps(over: Partial<PromptPostsDeps> = {}): PromptPostsDeps {
  return {
    selectedChannels: SELECTED,
    startDate: 1000,
    endDate: 9000,
    windowKey: LIVE_WINDOW,
    embeddingsEnabled: false,
    debouncedPostSearch: "",
    debouncedSemanticSearchQuery: "",
    relatedPostSearch: null,
    postFilter: NO_FILTER,
    postSelection: DEFAULT_SELECTION,
    postViewOptions: VIEW_OPTIONS,
    semanticSearchRespectsChannels: false,
    searchSimilarPosts: NO_SEARCH,
    getPostsFeed: NO_FEED,
    lookupPosts: NO_LOOKUP,
    getViewEstimate: NO_ESTIMATE,
    ...over,
  }
}

function render(over: Partial<PromptPostsDeps> = {}) {
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
      debouncedPostSearch: "crypto",
      postFilter: PERSIAN,
      postSelection: SELECTION,
      postViewOptions: {
        maxPostsPerChannel: 7,
        maxPostsPerChannelMode: "random",
        postSortOrder: "most_views",
        groupByChannel: true,
        viewMeasure: "views" as const,
      },
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
      debouncedSemanticSearchQuery: "crypto",
      relatedPostSearch: post(1),
      postSelection: SELECTION,
    }).getPromptPostsInput()

    expect(input.scope.selection).toBe(SELECTION)
  })

  test("the tab's ranked Posts come back flagged by the selection", async () => {
    const ranked = [post(1), post(2)]
    const looked: unknown[] = []
    const shown = await render({
      embeddingsEnabled: true,
      debouncedSemanticSearchQuery: "crypto",
      postFilter: PERSIAN,
      postSelection: SELECTION,
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

describe("getScopeSubmission", () => {
  test("the submission an Artifact freezes carries the selection and no Post filter", () => {
    const submission = render({
      postFilter: PERSIAN,
      postSelection: SELECTION,
      postViewOptions: {
        maxPostsPerChannel: 3,
        maxPostsPerChannelMode: "ordered",
        postSortOrder: "oldest",
        groupByChannel: true,
        viewMeasure: "estimated" as const,
      },
    }).getScopeSubmission(["alpha"])

    expect(submission).toEqual({
      channels: ["alpha"],
      window: submission.window,
      viewMeasure: "estimated",
      sort: "oldest",
      groupByChannel: true,
      selection: selectionBody(SELECTION),
    })
  })
})
