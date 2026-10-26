/**
 * The Posts view module at its provider (PVM-01, ADR-039): what each edit
 * does to the view, what survives a reload, and which identities hold still.
 *
 * The module is mounted with its inputs injected (`PostsViewModule`), the
 * URL a `useState` standing in for `?postFilter=`, so nothing here needs a
 * router, the other providers or `mock.module`.
 */

import { beforeEach, describe, expect, test } from "bun:test"
import { act, renderHook } from "@testing-library/react"
import { type ReactNode, useState } from "react"

import {
  POST_FILTER_STORAGE_KEYS,
  POST_SEARCH_DEBOUNCE_MS,
  type PostsViewInputs,
  PostsViewModule,
  usePostsKeyword,
  usePostsViewEdits,
  usePostsViewState,
} from "@/contexts/PostsViewContext"
import {
  addPostFunnel,
  emptyPostFilter,
  POST_FILTER_BOUNDS,
  printPostFilter,
} from "@/lib/posts/post-filter"
import {
  DEFAULT_SELECTION,
  MAX_PICKS,
  pick,
  rule,
} from "@/lib/posts/post-selection"
import { NO_RANKING, type PostsView } from "@/lib/posts/posts-view"
import type { WindowState } from "@/lib/scope/window"
import { scopedStorage } from "@/lib/storage/scoped"
import type { Post } from "@/types"

const LIVE: WindowState = { mode: "live", durationMs: 8000, endGapMs: 0 }
const CHANNELS = ["alpha", "beta"]
const never = async (): Promise<never> => {
  throw new Error("not fetched in this test")
}
const NOOP = () => {}

/** Module constants, as the real wiring hands down memoized values. */
const INPUTS: Omit<PostsViewInputs, "postFilterText" | "setPostFilterText"> = {
  selectedChannelNames: CHANNELS,
  startDate: 1000,
  endDate: 9000,
  windowKey: LIVE,
  setSelectedChannels: NOOP,
  setFixedRange: NOOP,
  embeddingsEnabled: false,
  searchSimilarPosts: never,
  getPostsFeed: never,
  lookupPosts: never,
  getViewEstimate: never,
}

function useModule() {
  return {
    state: usePostsViewState(),
    edits: usePostsViewEdits(),
    typed: usePostsKeyword(),
  }
}

/** The provider under a fake URL, with `over` replacing any input. */
function mount(over: Partial<PostsViewInputs> = {}, url?: string) {
  const urls: (string | undefined)[] = []
  function Wrapper({ children }: { children: ReactNode }) {
    const [text, setText] = useState(url)
    return (
      <PostsViewModule
        inputs={{
          ...INPUTS,
          postFilterText: text,
          setPostFilterText: (next) => {
            urls.push(next)
            setText(next)
          },
          ...over,
        }}
      >
        {children}
      </PostsViewModule>
    )
  }
  return { ...renderHook(useModule, { wrapper: Wrapper }), urls }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe("identity across a provider re-render", () => {
  test("the edits and the fetch for what the tab shows keep theirs", () => {
    const { result, rerender } = mount()
    const { edits, state } = result.current

    rerender()

    expect(result.current.edits).toBe(edits)
    expect(result.current.state.getScopedPosts).toBe(state.getScopedPosts)
    expect(result.current.state.view).toBe(state.view)
  })
})

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms))

const post = (id: number) =>
  ({ id, channelName: "alpha", text: `post ${id}`, timestamp: id }) as Post

describe("the keyword", () => {
  test("the search box sees each keystroke; the view sees the last one, once", async () => {
    const seen: string[] = []
    const { result } = mount()
    const record = () => {
      const keyword = result.current.state.view.keyword
      if (seen.at(-1) !== keyword) seen.push(keyword)
    }
    record()

    for (const typed of ["r", "ra", "rat"]) {
      act(() => result.current.edits.setKeyword(typed))
      record()
    }
    expect(result.current.typed).toBe("rat")
    await act(() => settle(POST_SEARCH_DEBOUNCE_MS + 50))
    record()

    expect(seen).toEqual(["", "rat"])
  })
})

describe("the ranking", () => {
  test("a related Post replaces a meaning query: never two at once", () => {
    const { result } = mount()
    act(() =>
      result.current.edits.setRanking({
        kind: "meaning",
        query: "rates",
        respectsChannels: true,
      }),
    )
    act(() =>
      result.current.edits.setRanking({ kind: "related", post: post(3) }),
    )

    expect(result.current.state.view.ranking).toEqual({
      kind: "related",
      post: post(3),
    })
  })

  test("an update reads the ranking it replaces", () => {
    const { result } = mount()
    act(() =>
      result.current.edits.setRanking({
        kind: "meaning",
        query: "rates",
        respectsChannels: true,
      }),
    )
    act(() =>
      result.current.edits.setRanking((current) => ({
        kind: "meaning",
        query: "inflation",
        respectsChannels:
          current.kind === "meaning" && current.respectsChannels,
      })),
    )

    expect(result.current.state.view.ranking).toEqual({
      kind: "meaning",
      query: "inflation",
      respectsChannels: true,
    })
  })
})

/** The order and cap as the view holds them. */
const orderOf = ({
  sort,
  groupByChannel,
  viewMeasure,
  maxPerChannel,
  maxPerChannelMode,
}: PostsView) => ({
  sort,
  groupByChannel,
  viewMeasure,
  maxPerChannel,
  maxPerChannelMode,
})

describe("the order", () => {
  test("is one value: an edit to one part keeps the rest", () => {
    const { result } = mount()
    act(() =>
      result.current.edits.setOrder({ maxPerChannel: 5, sort: "oldest" }),
    )
    act(() => result.current.edits.setOrder({ groupByChannel: true }))

    expect(orderOf(result.current.state.view)).toEqual({
      sort: "oldest",
      groupByChannel: true,
      viewMeasure: "estimated",
      maxPerChannel: 5,
      maxPerChannelMode: "ordered",
    })
  })
})

/** An edit's answer, applied inside `act`. */
function edit<T>(run: () => T): T {
  let answer: T | undefined
  act(() => {
    answer = run()
  })
  return answer as T
}

const PERSIAN = addPostFunnel(emptyPostFilter(), "language", "fa")

describe("the Post selection", () => {
  test("Picks alone are the edit; the revision moves on each one", () => {
    const { result } = mount()
    const picks = [pick(true, post(1)), pick(true, post(2))]

    expect(edit(() => result.current.edits.appendSelection(picks))).toBe(true)

    expect(result.current.state.view.selection).toEqual([
      ...DEFAULT_SELECTION,
      ...picks,
    ])
    expect(result.current.state.view.selectionRevision).toBe(1)
    expect(result.current.state.selectionEdit.picks).toEqual(picks)
  })

  test("a rule is not Picks: the feed refetches rather than patching", () => {
    const { result } = mount()
    act(() => {
      result.current.edits.appendSelection([rule(false)])
    })

    expect(result.current.state.selectionEdit).toEqual({
      revision: 1,
      picks: null,
    })
  })

  test("a refused append changes nothing and says so", () => {
    const { result } = mount()
    const tooMany = Array.from({ length: MAX_PICKS + 1 }, (_, i) =>
      pick(true, post(i)),
    )

    expect(edit(() => result.current.edits.appendSelection(tooMany))).toBe(
      false,
    )
    expect(result.current.state.view.selection).toEqual(DEFAULT_SELECTION)
    expect(result.current.state.view.selectionRevision).toBe(0)
  })

  test("two appends in one tick each build on the other", () => {
    const { result } = mount()
    act(() => {
      result.current.edits.appendSelection([pick(true, post(1))])
      result.current.edits.appendSelection([pick(false, post(2))])
    })

    expect(result.current.state.view.selection).toEqual([
      ...DEFAULT_SELECTION,
      pick(true, post(1)),
      pick(false, post(2)),
    ])
  })

  test("removing a chip removes its steps; replacing replaces them all", () => {
    const { result } = mount()
    act(() => {
      result.current.edits.appendSelection([pick(true, post(1))])
    })
    act(() => result.current.edits.removeSelectionChip({ start: 1, end: 2 }))
    expect(result.current.state.view.selection).toEqual(DEFAULT_SELECTION)

    act(() => result.current.edits.replaceSelection([rule(false)]))
    expect(result.current.state.view.selection).toEqual([rule(false)])
    expect(result.current.state.view.selectionRevision).toBe(3)
  })

  test("lasts for the browser session, and only there", () => {
    const first = mount()
    act(() => {
      first.result.current.edits.appendSelection([pick(true, post(1))])
    })
    first.unmount()

    expect(mount().result.current.state.view.selection).toEqual([
      ...DEFAULT_SELECTION,
      pick(true, post(1)),
    ])
    expect(JSON.stringify(localStorage)).not.toContain("postSelection")
  })
})

describe("the Post filter, in the URL", () => {
  test("is read from the link", () => {
    const { result } = mount({}, "lang:fa")

    expect(printPostFilter(result.current.state.view.filter)).toBe("lang:fa")
  })

  test("a link that does not parse shows every Post", () => {
    const { result } = mount({}, "lang:(")

    expect(result.current.state.view.filter.children).toEqual([])
  })

  test("an edit is written to the link, and an empty one leaves it", () => {
    const { result, urls } = mount()
    act(() => result.current.edits.setPostFilter(PERSIAN))
    expect(printPostFilter(result.current.state.view.filter)).toBe("lang:fa")

    act(() => result.current.edits.setPostFilter(emptyPostFilter()))
    expect(urls).toEqual(["lang:fa", undefined])
  })

  test("one past the server's bounds is refused, not written", () => {
    const { result, urls } = mount()
    let deep = emptyPostFilter()
    for (let i = 0; i <= POST_FILTER_BOUNDS.nodes; i++)
      deep = addPostFunnel(deep, "language", `l${i}`)

    act(() => result.current.edits.setPostFilter(deep))

    expect(urls).toEqual([])
  })
})

describe("restore", () => {
  test("replaces every part of the view and clears the ranking", async () => {
    const channels: Set<string>[] = []
    const windows: [number, number][] = []
    const { result } = mount({
      setSelectedChannels: (next) => channels.push(next),
      setFixedRange: (start, end) => windows.push([start, end]),
    })
    act(() => {
      const { edits } = result.current
      edits.setKeyword("old")
      edits.setPostFilter(PERSIAN)
      edits.setOrder({ maxPerChannel: 9, groupByChannel: true })
      edits.appendSelection([pick(true, post(1))])
      edits.setRanking({ kind: "related", post: post(4) })
    })
    const selection = [rule(false), pick(true, post(7))]

    act(() =>
      result.current.edits.restore({
        start: 10,
        end: 20,
        channels: ["beta"],
        keyword: "rates",
        sort: "oldest",
        viewMeasure: "views",
        selection,
      }),
    )
    await act(() => settle(POST_SEARCH_DEBOUNCE_MS + 50))

    const { view } = result.current.state
    expect(channels).toEqual([new Set(["beta"])])
    expect(windows).toEqual([[10, 20]])
    expect(view.keyword).toBe("rates")
    expect(view.filter.children).toEqual([])
    expect(orderOf(view)).toEqual({
      sort: "oldest",
      groupByChannel: false,
      viewMeasure: "views",
      maxPerChannel: 0,
      maxPerChannelMode: "ordered",
    })
    expect(view.selection).toEqual(selection)
    expect(view.ranking).toEqual(NO_RANKING)
  })
})

describe("the order and cap, in per-Account browser storage", () => {
  const stored = (key: keyof typeof POST_FILTER_STORAGE_KEYS) =>
    scopedStorage.getItem(POST_FILTER_STORAGE_KEYS[key])
  const store = (key: keyof typeof POST_FILTER_STORAGE_KEYS, value: string) =>
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS[key], value)
  const order = () => orderOf(mount().result.current.state.view)

  test("defaults when nothing is stored", () => {
    expect(order()).toEqual({
      sort: "newest",
      groupByChannel: false,
      viewMeasure: "estimated",
      maxPerChannel: 0,
      maxPerChannelMode: "ordered",
    })
  })

  test("an edit survives a remount", () => {
    const first = mount()
    act(() =>
      first.result.current.edits.setOrder({
        sort: "fewest_views",
        groupByChannel: true,
        viewMeasure: "views",
        maxPerChannel: 9,
        maxPerChannelMode: "random",
      }),
    )
    first.unmount()

    expect(order()).toEqual({
      sort: "fewest_views",
      groupByChannel: true,
      viewMeasure: "views",
      maxPerChannel: 9,
      maxPerChannelMode: "random",
    })
  })

  test("a hostile stored value falls back rather than reaching a request", () => {
    // `NaN` would reach the feed as `maxPerChannel: NaN` and 422; so would a
    // sort the server's FEED_SORTS does not know.
    store("maxPerChannel", "not a number")
    store("maxPerChannelMode", "alphabetical")
    store("sortOrder", "relevance")
    store("groupByChannel", "sideways")
    store("viewMeasure", "likes")

    expect(order()).toEqual({
      sort: "newest",
      groupByChannel: false,
      viewMeasure: "estimated",
      maxPerChannel: 0,
      maxPerChannelMode: "ordered",
    })
  })

  test("a negative cap falls back to 0", () => {
    store("maxPerChannel", "-5")
    expect(order().maxPerChannel).toBe(0)
  })

  test("an earlier bundle's `latest` and `channel_time` read as ordered, newest grouped (PFB-01)", () => {
    store("maxPerChannelMode", "latest")
    store("sortOrder", "channel_time")

    expect(order()).toMatchObject({
      sort: "newest",
      groupByChannel: true,
      maxPerChannelMode: "ordered",
    })
    // Written back in the new shape, so a remount reads it once.
    expect([
      stored("maxPerChannelMode"),
      stored("sortOrder"),
      stored("groupByChannel"),
    ]).toEqual(["ordered", "newest", "true"])
  })

  test("a stored `time` reads as newest, ungrouped", () => {
    store("sortOrder", "time")
    expect(order()).toMatchObject({ sort: "newest", groupByChannel: false })
  })

  test("neither the keyword nor the ranking is stored", () => {
    const { result } = mount()
    act(() => {
      result.current.edits.setKeyword("crypto")
      result.current.edits.setRanking({
        kind: "meaning",
        query: "crypto",
        respectsChannels: false,
      })
    })

    expect(JSON.stringify(localStorage)).not.toContain("crypto")
    expect(JSON.stringify(sessionStorage)).not.toContain("crypto")
  })

  test("exactly the five keys an earlier bundle used", () => {
    expect(Object.values(POST_FILTER_STORAGE_KEYS).sort()).toEqual([
      "postFilter_groupByChannel",
      "postFilter_maxPerChannel",
      "postFilter_maxPerChannelMode",
      "postFilter_sortOrder",
      "postFilter_viewMeasure",
    ])
  })
})
