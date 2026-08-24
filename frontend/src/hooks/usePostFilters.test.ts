/**
 * The Posts tab's filter state and what survives a reload (G1).
 *
 * Four of these ten values persist to browser storage by hand, outside
 * `lib/settings/schema.ts`. That is deliberate (see the hook's docstring) but
 * it means the parse-and-fall-back logic is hand-rolled, and hand-rolled
 * hydration is where a bad stored value turns into `NaN` posts per channel or
 * an unknown sort the server rejects.
 *
 * So these tests care about two things: that exactly the four intended keys
 * persist, and that every one of them survives a hostile stored value.
 */

import { beforeEach, describe, expect, test } from "bun:test"
import { act, renderHook } from "@testing-library/react"

import {
  POST_FILTER_STORAGE_KEYS,
  usePostFilters,
} from "@/hooks/usePostFilters"
import { scopedKey, scopedStorage } from "@/lib/storage/scoped"

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

    expect(result.current.mediaFilter).toBe("all")
    expect(result.current.maxPostsPerChannel).toBe(0)
    expect(result.current.maxPostsPerChannelMode).toBe("latest")
    expect(result.current.postSortOrder).toBe("time")
    expect(result.current.forwardedFilter).toBe("all")
  })

  test("reads back what was stored", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.maxPerChannel, "25")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.maxPerChannelMode, "random")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.sortOrder, "channel_time")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.media, "photo")

    const { result } = renderHook(() => usePostFilters())

    expect(result.current.maxPostsPerChannel).toBe(25)
    expect(result.current.maxPostsPerChannelMode).toBe("random")
    expect(result.current.postSortOrder).toBe("channel_time")
    expect(result.current.mediaFilter).toBe("photo")
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

  test("an unknown cap mode falls back to latest", () => {
    scopedStorage.setItem(
      POST_FILTER_STORAGE_KEYS.maxPerChannelMode,
      "alphabetical",
    )

    expect(
      renderHook(() => usePostFilters()).result.current.maxPostsPerChannelMode,
    ).toBe("latest")
  })

  test("an unknown sort falls back to time", () => {
    // The server's FEED_SORTS is {time, channel_time}; anything else is a 422.
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.sortOrder, "relevance")

    expect(
      renderHook(() => usePostFilters()).result.current.postSortOrder,
    ).toBe("time")
  })

  test("an unknown media filter falls back to all", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.media, "hologram")

    expect(renderHook(() => usePostFilters()).result.current.mediaFilter).toBe(
      "all",
    )
  })
})

describe("usePostFilters — persistence", () => {
  test("the cap, its mode, the sort and the media filter persist", () => {
    const { result } = renderHook(() => usePostFilters())

    act(() => {
      result.current.setMaxPostsPerChannel(12)
      result.current.setMaxPostsPerChannelMode("random")
      result.current.setPostSortOrder("channel_time")
      result.current.setMediaFilter("video")
    })

    expect(scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.maxPerChannel)).toBe(
      "12",
    )
    expect(
      scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.maxPerChannelMode),
    ).toBe("random")
    expect(scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.sortOrder)).toBe(
      "channel_time",
    )
    expect(scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.media)).toBe("video")
  })

  test("searches and the forwarded filter do NOT persist", () => {
    // Characterising a deliberate asymmetry: a forwarded filter or a stale
    // search surviving a reload reads as "the app lost my posts", because
    // nothing on screen says the filter is on.
    const { result } = renderHook(() => usePostFilters())

    act(() => {
      result.current.setPostSearch("crypto")
      result.current.setSemanticSearchQuery("crypto")
      result.current.setForwardedFilter("forwarded")
    })

    expect(
      Object.keys(localStorage).filter((k) => k.includes("postFilter_")),
    ).not.toContain(scopedKey("postFilter_forwarded"))
    expect(JSON.stringify(localStorage)).not.toContain("crypto")
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
  test("mirrors the three view fields", () => {
    const { result } = renderHook(() => usePostFilters())

    act(() => {
      result.current.setMaxPostsPerChannel(5)
      result.current.setMaxPostsPerChannelMode("random")
      result.current.setPostSortOrder("channel_time")
    })

    expect(result.current.postViewOptions).toEqual({
      maxPostsPerChannel: 5,
      maxPostsPerChannelMode: "random",
      postSortOrder: "channel_time",
    })
  })
})
