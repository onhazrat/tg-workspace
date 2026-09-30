/**
 * The Posts tab's filter state and what survives a reload (G1).
 *
 * Five of these eleven values persist to browser storage by hand, outside
 * `lib/settings/schema.ts`. That is deliberate (see the hook's docstring) but
 * it means the parse-and-fall-back logic is hand-rolled, and hand-rolled
 * hydration is where a bad stored value turns into `NaN` posts per channel or
 * an unknown sort the server rejects.
 *
 * So these tests care about three things: that exactly the five intended keys
 * persist, that every one of them survives a hostile stored value, and that a
 * value the previous bundle stored is read into PFB-01's shape once.
 */

import { beforeEach, describe, expect, test } from "bun:test"
import { act, renderHook } from "@testing-library/react"

import {
  POST_FILTER_STORAGE_KEYS,
  usePostFilters,
} from "@/hooks/usePostFilters"
import type { MediaKind } from "@/lib/posts/post-media"
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

    expect(result.current.mediaFilter).toEqual([])
    expect(result.current.languageFilter).toEqual([])
    expect(result.current.maxPostsPerChannel).toBe(0)
    expect(result.current.maxPostsPerChannelMode).toBe("ordered")
    expect(result.current.postSortOrder).toBe("newest")
    expect(result.current.groupByChannel).toBe(false)
    expect(result.current.forwardedFilter).toBe("all")
  })

  test("reads back what was stored", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.maxPerChannel, "25")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.maxPerChannelMode, "random")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.sortOrder, "oldest")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.groupByChannel, "true")
    scopedStorage.setItem(
      POST_FILTER_STORAGE_KEYS.media,
      JSON.stringify(["photo", "video"]),
    )

    const { result } = renderHook(() => usePostFilters())

    expect(result.current.maxPostsPerChannel).toBe(25)
    expect(result.current.maxPostsPerChannelMode).toBe("random")
    expect(result.current.postSortOrder).toBe("oldest")
    expect(result.current.groupByChannel).toBe(true)
    expect(result.current.mediaFilter).toEqual(["photo", "video"])
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

  test("an unknown media filter falls back to any media", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.media, "hologram")

    expect(
      renderHook(() => usePostFilters()).result.current.mediaFilter,
    ).toEqual([])
  })

  test("an unknown kind inside a stored set is dropped, not sent", () => {
    // A kind the server does not implement is a 422 for the whole feed.
    scopedStorage.setItem(
      POST_FILTER_STORAGE_KEYS.media,
      JSON.stringify(["photo", "hologram", 7]),
    )

    expect(
      renderHook(() => usePostFilters()).result.current.mediaFilter,
    ).toEqual(["photo"])
  })

  test("an unreadable grouping flag reads as ungrouped", () => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.groupByChannel, "sideways")

    expect(
      renderHook(() => usePostFilters()).result.current.groupByChannel,
    ).toBe(false)
  })
})

describe("usePostFilters — values the previous bundle stored (PFB-01)", () => {
  test.each<[string, MediaKind[]]>([
    ["all", []],
    ["photo", ["photo"]],
    ["link_preview", ["link_preview"]],
  ])("a stored media value %p reads as %p", (stored, expected) => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.media, stored)

    expect(
      renderHook(() => usePostFilters()).result.current.mediaFilter,
    ).toEqual(expected)
  })

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
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.media, "photo")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.maxPerChannelMode, "latest")
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.sortOrder, "channel_time")

    renderHook(() => usePostFilters())

    expect(scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.media)).toBe(
      JSON.stringify(["photo"]),
    )
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
    expect(second.result.current.mediaFilter).toEqual(["photo"])
  })
})

describe("usePostFilters — persistence", () => {
  test("the cap, its mode, the order, grouping and the media set persist", () => {
    const { result } = renderHook(() => usePostFilters())

    act(() => {
      result.current.setMaxPostsPerChannel(12)
      result.current.setMaxPostsPerChannelMode("random")
      result.current.setPostSortOrder("oldest")
      result.current.setGroupByChannel(true)
      result.current.setMediaFilter(["video"])
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
    expect(scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.media)).toBe(
      JSON.stringify(["video"]),
    )
  })

  test("the Language set persists under a key of its own (PFB-02)", () => {
    const first = renderHook(() => usePostFilters())
    act(() => {
      first.result.current.setLanguageFilter(["fa", "en"])
    })

    expect(scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.languages)).toBe(
      JSON.stringify(["fa", "en"]),
    )
    const second = renderHook(() => usePostFilters())
    expect(second.result.current.languageFilter).toEqual(["fa", "en"])
  })

  test("an unreadable stored Language set reads as any Language", () => {
    for (const raw of ["not json", '"fa"', "[1, null]", '{"fa": 1}']) {
      scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.languages, raw)
      const { result } = renderHook(() => usePostFilters())
      expect(result.current.languageFilter).toEqual([])
    }
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.languages, '["fa", 3]')
    const { result } = renderHook(() => usePostFilters())
    expect(result.current.languageFilter).toEqual(["fa"])
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
  test("mirrors the four view fields", () => {
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
    })
  })
})
