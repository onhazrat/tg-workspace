/**
 * The Posts tab's filter state and what survives a reload (G1).
 *
 * Five of these values persist to browser storage by hand, outside
 * `lib/settings/schema.ts`. That is deliberate (see the hook's docstring) but
 * it means the parse-and-fall-back logic is hand-rolled, and hand-rolled
 * hydration is where a bad stored value turns into `NaN` posts per channel or
 * an unknown sort the server rejects.
 *
 * So these tests care about three things: that exactly the five intended keys
 * persist, that every one of them survives a hostile stored value, and that a
 * value the previous bundle stored is read into PFB-01's shape once.
 *
 * The Type, media, Language and views filters are the Post filter since
 * PTR-03, which lives in the URL; their keys are gone from here.
 */

import { beforeEach, describe, expect, test } from "bun:test"
import { act, renderHook } from "@testing-library/react"

import {
  POST_FILTER_STORAGE_KEYS,
  usePostFilters,
} from "@/hooks/usePostFilters"
import { scopedStorage } from "@/lib/storage/scoped"

// Ticket 02: these four keys live under the signed-in account's namespace, so
// the test has to read them the way the hook writes them. Nothing here signs
// in, which puts both sides in `u:anon:` — the namespacing itself is covered
// once, in `lib/storage/scoped.test.ts`, rather than again in every hook.

beforeEach(() => {
  localStorage.clear()
})

describe("usePostFilters — hydration", () => {
  test("defaults when nothing is stored", () => {
    const { result } = renderHook(() => usePostFilters())

    expect(result.current.maxPostsPerChannel).toBe(0)
    expect(result.current.maxPostsPerChannelMode).toBe("ordered")
    expect(result.current.postSortOrder).toBe("newest")
    expect(result.current.groupByChannel).toBe(false)
    expect(result.current.viewMeasure).toBe("estimated")
  })

  test("reads back what was stored", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.maxPerChannel, "25")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.maxPerChannelMode, "random")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.sortOrder, "oldest")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.groupByChannel, "true")

    const { result } = renderHook(() => usePostFilters())

    expect(result.current.maxPostsPerChannel).toBe(25)
    expect(result.current.maxPostsPerChannelMode).toBe("random")
    expect(result.current.postSortOrder).toBe("oldest")
    expect(result.current.groupByChannel).toBe(true)
  })

  test("a non-numeric cap falls back to 0 rather than NaN", () => {
    // `NaN` would reach the feed as `maxPerChannel: NaN` and 422.
    scopedStorage.setItem(
      POST_FILTER_STORAGE_KEYS.maxPerChannel,
      "not a number",
    )

    expect(
      renderHook(() => usePostFilters()).result.current.maxPostsPerChannel,
    ).toBe(0)
  })

  test("a negative cap falls back to 0", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.maxPerChannel, "-5")

    expect(
      renderHook(() => usePostFilters()).result.current.maxPostsPerChannel,
    ).toBe(0)
  })

  test("an unknown cap mode falls back to ordered", () => {
    scopedStorage.setItem(
      POST_FILTER_STORAGE_KEYS.maxPerChannelMode,
      "alphabetical",
    )

    expect(
      renderHook(() => usePostFilters()).result.current.maxPostsPerChannelMode,
    ).toBe("ordered")
  })

  test("an unknown sort falls back to newest", () => {
    // The server's FEED_SORTS is {newest, oldest}; anything else is a 422.
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.sortOrder, "relevance")

    expect(
      renderHook(() => usePostFilters()).result.current.postSortOrder,
    ).toBe("newest")
  })

  test("an unreadable grouping flag reads as ungrouped", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.groupByChannel, "sideways")

    expect(
      renderHook(() => usePostFilters()).result.current.groupByChannel,
    ).toBe(false)
  })
})

describe("usePostFilters — values the previous bundle stored (PFB-01)", () => {
  test("a stored `latest` reads as `ordered`", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.maxPerChannelMode, "latest")

    expect(
      renderHook(() => usePostFilters()).result.current.maxPostsPerChannelMode,
    ).toBe("ordered")
  })

  test("a stored `time` reads as newest, ungrouped", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.sortOrder, "time")

    const { result } = renderHook(() => usePostFilters())

    expect(result.current.postSortOrder).toBe("newest")
    expect(result.current.groupByChannel).toBe(false)
  })

  test("a stored `channel_time` reads as newest, grouped", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.sortOrder, "channel_time")

    const { result } = renderHook(() => usePostFilters())

    expect(result.current.postSortOrder).toBe("newest")
    expect(result.current.groupByChannel).toBe(true)
  })

  test("the old spelling is read once and written back in the new shape", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.maxPerChannelMode, "latest")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.sortOrder, "channel_time")

    renderHook(() => usePostFilters())

    expect(
      scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.maxPerChannelMode),
    ).toBe("ordered")
    expect(scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.sortOrder)).toBe(
      "newest",
    )
    expect(scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.groupByChannel)).toBe(
      "true",
    )
    // And a remount reads the new shape, not the old one again.
    const second = renderHook(() => usePostFilters())
    expect(second.result.current.groupByChannel).toBe(true)
  })
})

describe("usePostFilters — persistence", () => {
  test("the cap, its mode, the order and grouping persist", () => {
    const { result } = renderHook(() => usePostFilters())

    act(() => {
      result.current.setMaxPostsPerChannel(12)
      result.current.setMaxPostsPerChannelMode("random")
      result.current.setPostSortOrder("oldest")
      result.current.setGroupByChannel(true)
    })

    expect(scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.maxPerChannel)).toBe(
      "12",
    )
    expect(
      scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.maxPerChannelMode),
    ).toBe("random")
    expect(scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.sortOrder)).toBe(
      "oldest",
    )
    expect(scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.groupByChannel)).toBe(
      "true",
    )
  })

  test("the views orders' measure persists under a key of its own (PFB-03)", () => {
    const first = renderHook(() => usePostFilters())
    act(() => {
      first.result.current.setViewMeasure("views")
      first.result.current.setPostSortOrder("fewest_views")
    })

    const second = renderHook(() => usePostFilters())
    expect(second.result.current.viewMeasure).toBe("views")
    expect(second.result.current.postSortOrder).toBe("fewest_views")
  })

  test("searches do NOT persist", () => {
    // Characterising a deliberate asymmetry: a stale search surviving a
    // reload reads as "the app lost my posts".
    const { result } = renderHook(() => usePostFilters())

    act(() => {
      result.current.setPostSearch("crypto")
      result.current.setSemanticSearchQuery("crypto")
    })

    expect(JSON.stringify(localStorage)).not.toContain("crypto")
  })

  test("exactly five keys persist; the retired filters' are gone (PTR-03)", () => {
    expect(Object.values(POST_FILTER_STORAGE_KEYS).sort()).toEqual([
      "postFilter_groupByChannel",
      "postFilter_maxPerChannel",
      "postFilter_maxPerChannelMode",
      "postFilter_sortOrder",
      "postFilter_viewMeasure",
    ])
  })

  test("a full round trip: set, remount, read back", () => {
    const first = renderHook(() => usePostFilters())
    act(() => {
      first.result.current.setMaxPostsPerChannel(9)
    })

    const second = renderHook(() => usePostFilters())
    expect(second.result.current.maxPostsPerChannel).toBe(9)
  })
})

describe("usePostFilters — postViewOptions", () => {
  test("mirrors the five view fields", () => {
    const { result } = renderHook(() => usePostFilters())

    act(() => {
      result.current.setMaxPostsPerChannel(5)
      result.current.setMaxPostsPerChannelMode("random")
      result.current.setPostSortOrder("oldest")
      result.current.setGroupByChannel(true)
    })

    expect(result.current.postViewOptions).toEqual({
      maxPostsPerChannel: 5,
      maxPostsPerChannelMode: "random",
      postSortOrder: "oldest",
      groupByChannel: true,
      viewMeasure: "estimated" as const,
    })
  })
})
