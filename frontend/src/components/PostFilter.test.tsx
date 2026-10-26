/**
 * The Posts filter bar (PFB-02, PTR-03), rendered props-only so it needs no
 * providers and no `mock.module` (process-wide in bun, see
 * `DataContext.test.tsx`). What is pinned is what an Account can do on it:
 * search by keyword or by meaning, funnel from the Type, Media and Language
 * dropdowns, bound Views from the Filters menu, edit the Post filter in its
 * row, and drop what the footer shows.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type React from "react"
import type { PostValueHistogramResponse } from "@/client"
import type { ViewMeasure } from "@/lib/posts/estimated-views"
import {
  addPostFunnel,
  emptyPostFilter,
  type PostCond,
  type PostFilter,
  type PostNumber,
  printPostFilter,
} from "@/lib/posts/post-filter"
import {
  type FilterBarControls,
  PostFilterBar,
  type PostFilterBarProps,
  SearchBox,
} from "./PostFilter"
import {
  PostValueHistogramContext,
  type ValueHistogramZoom,
} from "./PostFilterControls"

afterEach(cleanup)

type Calls = [string, unknown][]

function controls(
  calls: Calls,
  over: Partial<FilterBarControls> = {},
): FilterBarControls {
  const log =
    (name: string) =>
    (value: unknown): void => {
      calls.push([name, value])
    }
  const base = {
    semanticSearchQuery: "",
    semanticSearchRespectsChannels: true,
    relatedPostSearch: null,
    postFilter: emptyPostFilter(),
    viewMeasure: "estimated" as const,
    maxPostsPerChannel: 0,
    maxPostsPerChannelMode: "ordered" as const,
    postSortOrder: "newest" as const,
    groupByChannel: false,
    ...over,
  }
  return {
    ...base,
    setSemanticSearchQuery: log("meaning"),
    setSemanticSearchRespectsChannels: log("respectsChannels"),
    setRelatedPostSearch: log("related"),
    // The tree as its text, which is what an Account would read in the URL.
    setPostFilter: (next: PostFilter) =>
      calls.push(["filter", printPostFilter(next)]),
    setViewMeasure: log("measure"),
    setMaxPostsPerChannel: log("cap"),
    setMaxPostsPerChannelMode: log("capMode"),
    setPostSortOrder: log("order"),
    setGroupByChannel: log("grouped"),
  }
}

function mount(
  over: Partial<FilterBarControls> = {},
  {
    embeddingsEnabled = false,
    ...props
  }: Partial<PostFilterBarProps> & { embeddingsEnabled?: boolean } = {},
  wrapper?: React.JSXElementConstructor<{ children: React.ReactNode }>,
) {
  const calls: Calls = []
  const opened: boolean[] = []
  const setPostSearch = (value: string) => calls.push(["keyword", value])
  const barControls = controls(calls, over)
  render(
    <PostFilterBar
      postSearch=""
      setPostSearch={setPostSearch}
      shownCount={1234}
      subtitle=""
      tooNewToJudge={0}
      estimationFloorHours={3}
      controls={barControls}
      searchBox={
        <SearchBox
          postSearch=""
          setPostSearch={setPostSearch}
          controls={barControls}
          embeddingsEnabled={embeddingsEnabled}
        />
      }
      windowControl={<span>window</span>}
      facets={{
        total: 5000,
        types: [{ value: "original", count: 4000, selected: 4000 }],
        languages: [
          { value: "fa", count: 120, selected: 30 },
          { value: "zxx", count: 9, selected: 0 },
        ],
        media: [{ value: "photo", count: 55, selected: 55 }],
      }}
      onFacetTick={(facet, value, select) =>
        calls.push([
          "tick",
          `${select ? "select" : "deselect"} ${facet}:${value}`,
        ])
      }
      channelLanguages={[]}
      channelNames={["durov", "news"]}
      onCountingPillOpenChange={(open) => opened.push(open)}
      {...props}
    />,
    { wrapper },
  )
  return { calls, opened }
}

describe("the search box", () => {
  test("filters by keyword as you type, with no meaning switch while semantic is off", () => {
    const { calls } = mount()
    fireEvent.change(screen.getByLabelText("Keyword search"), {
      target: { value: "rates" },
    })
    expect(calls).toEqual([["keyword", "rates"]])
    expect(screen.queryByText("Meaning")).toBeNull()
  })

  test("Meaning clears the keyword and runs on Enter", () => {
    const { calls } = mount({}, { embeddingsEnabled: true })
    fireEvent.click(screen.getByText("Meaning"))
    const box = screen.getByLabelText("Meaning search")
    fireEvent.change(box, { target: { value: " inflation " } })
    fireEvent.keyDown(box, { key: "a" })
    fireEvent.keyDown(box, { key: "Enter" })
    fireEvent.click(
      screen.getByLabelText("Search every channel, not only the selected ones"),
    )
    expect(calls).toEqual([
      ["keyword", ""],
      ["meaning", "inflation"],
      ["respectsChannels", false],
    ])
  })

  test("back to Keyword ends the meaning search", () => {
    const { calls } = mount(
      { semanticSearchQuery: "inflation" },
      { embeddingsEnabled: true },
    )
    expect(screen.getByLabelText("Meaning search")).toBeTruthy()
    fireEvent.click(screen.getByText("Keyword"))
    expect(calls).toEqual([["meaning", ""]])
  })
})

const funnels = (...pairs: ["type" | "media" | "language", string][]) =>
  pairs.reduce(
    (filter, [facet, value]) => addPostFunnel(filter, facet, value),
    emptyPostFilter(),
  )

describe("the dropdowns", () => {
  test("each names what it funnels, and the defaults read as defaults", () => {
    mount({
      postFilter: funnels(
        ["media", "photo"],
        ["media", "video"],
        ["language", "zxx"],
      ),
      maxPostsPerChannel: 10,
      postSortOrder: "oldest",
    })
    expect(screen.getByTestId("post-filter-type").textContent).toContain("Type")
    expect(screen.getByTestId("post-filter-media").textContent).toContain(
      "2 media",
    )
    expect(screen.getByTestId("post-filter-language").textContent).toContain(
      "No words",
    )
    expect(screen.getByTestId("post-sort").textContent).toContain("Post date")
    expect(screen.getByLabelText("Sort ascending")).toBeTruthy()
    expect(screen.getByTestId("post-filter-pill-cap").textContent).toContain(
      "Oldest 10",
    )
  })

  test("Media funnels a kind, with its count in the window, and asks for counts on open", () => {
    const { calls, opened } = mount()
    fireEvent.click(screen.getByTestId("post-filter-media"))
    expect(opened).toEqual([true])
    expect(
      screen.getByTestId("post-filter-media-count-photo").textContent,
    ).toBe("55/55")
    fireEvent.click(screen.getByTestId("post-filter-media-funnel-photo"))
    expect(calls).toEqual([["filter", "media:photo"]])
  })

  test("a second funnel in one dropdown joins with OR, and a funnel comes off again", () => {
    const { calls } = mount({ postFilter: funnels(["language", "fa"]) })
    fireEvent.click(screen.getByTestId("post-filter-language"))
    expect(screen.getByText("No words")).toBeTruthy()
    expect(
      screen.getByTestId("post-filter-language-count-fa").textContent,
    ).toBe("30/120")
    fireEvent.click(screen.getByTestId("post-filter-language-funnel-zxx"))
    fireEvent.click(screen.getByTestId("post-filter-language-funnel-fa"))
    expect(calls).toEqual([
      ["filter", "(lang:fa or lang:zxx)"],
      ["filter", ""],
    ])
  })

  test("funnels in different dropdowns join with AND", () => {
    const { calls } = mount({ postFilter: funnels(["media", "photo"]) })
    fireEvent.click(screen.getByTestId("post-filter-type"))
    fireEvent.click(screen.getByTestId("post-filter-type-funnel-original"))
    expect(calls).toEqual([["filter", "media:photo and type:original"]])
  })

  test("Type lists both reply Types last, with their counts and text forms (PTI-04)", () => {
    const { calls } = mount(
      {},
      {
        facets: {
          total: 50,
          types: [
            { value: "is_reply", count: 12, selected: 3 },
            { value: "has_reply", count: 7, selected: 7 },
          ],
          languages: [],
          media: [],
        },
      },
    )
    fireEvent.click(screen.getByTestId("post-filter-type"))
    const rows = [
      ...document.querySelectorAll("[data-testid^='post-filter-type-row-']"),
    ]
    expect(rows.map((row) => row.textContent?.slice(1)).slice(-2)).toEqual([
      "Is a reply",
      "Has a reply",
    ])
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
      "mixed",
      "true",
    ])
    expect(
      screen.getByTestId("post-filter-type-count-is_reply").textContent,
    ).toBe("3/12")
    expect(
      screen.getByTestId("post-filter-type-count-has_reply").textContent,
    ).toBe("7/7")
    fireEvent.click(screen.getByTestId("post-filter-type-funnel-is_reply"))
    fireEvent.click(screen.getByTestId("post-filter-type-funnel-has_reply"))
    expect(calls).toEqual([
      ["filter", "type:is_reply"],
      ["filter", "type:has_reply"],
    ])
  })
})

describe("the ticks (PTR-06)", () => {
  const tick = (facet: string, value: string) =>
    screen.getByTestId(`post-filter-${facet}-row-${value}`)

  test("read all, some or none of a value's Posts, over the window", () => {
    mount()
    fireEvent.click(screen.getByTestId("post-filter-language"))
    expect(tick("language", "fa").getAttribute("aria-checked")).toBe("mixed")
    expect(tick("language", "zxx").getAttribute("aria-checked")).toBe("false")
    expect(screen.getByText(/whatever the filter shows/)).toBeTruthy()
    cleanup()

    mount()
    fireEvent.click(screen.getByTestId("post-filter-type"))
    expect(tick("type", "original").getAttribute("aria-checked")).toBe("true")
  })

  test("select a value with nothing selected, deselect one with some or all", () => {
    const { calls } = mount()
    fireEvent.click(screen.getByTestId("post-filter-language"))
    fireEvent.click(tick("language", "fa"))
    fireEvent.click(tick("language", "zxx"))
    cleanup()
    const second = mount()
    fireEvent.click(screen.getByTestId("post-filter-type"))
    fireEvent.click(tick("type", "original"))

    expect(calls).toEqual([
      ["tick", "deselect language:fa"],
      ["tick", "select language:zxx"],
    ])
    expect(second.calls).toEqual([["tick", "deselect type:original"]])
  })

  test("leave no tick column while the window's counts are unknown", () => {
    mount({}, { facets: undefined })
    fireEvent.click(screen.getByTestId("post-filter-language"))
    expect(screen.queryByRole("checkbox")).toBeNull()
  })
})

describe("the Filters menu", () => {
  test("adds a bound on Views", () => {
    const { calls } = mount()
    fireEvent.click(screen.getByTestId("post-filters"))
    fireEvent.click(screen.getByTestId("post-filters-views"))
    expect(screen.getByText(/What Telegram shows now/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "10000" },
    })
    fireEvent.click(screen.getByTestId("number-bound-submit"))
    expect(calls).toEqual([["filter", "views >= 10000"]])
  })

  test("between, at most and no value on Estimated views, with the deployment's floor", () => {
    const { calls } = mount({}, { estimationFloorHours: 1 })
    fireEvent.click(screen.getByTestId("post-filters"))
    fireEvent.click(screen.getByTestId("post-filters-estimated"))
    expect(screen.getByText(/Posts under 1 hour are too new/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "between" }))
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "5" } })
    // Incomplete, and then backwards: neither can be added.
    const submit = () =>
      screen.getByTestId("number-bound-submit") as HTMLButtonElement
    expect(submit().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "1" } })
    expect(submit().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "50" } })
    fireEvent.click(submit())
    fireEvent.click(screen.getByTestId("post-filters"))
    fireEvent.click(screen.getByTestId("post-filters-estimated"))
    fireEvent.click(screen.getByRole("button", { name: "no value" }))
    fireEvent.click(submit())
    expect(calls).toEqual([
      ["filter", "estimated 5..50"],
      ["filter", "estimated = none"],
    ])
  })

  test("lists the bounds the filter already holds, NOT included", () => {
    mount({
      postFilter: {
        ...emptyPostFilter(),
        children: [
          {
            kind: "atom",
            id: "v",
            not: true,
            cond: { type: "views", measure: "views", min: 1000 },
          },
        ],
      },
    })
    fireEvent.click(screen.getByTestId("post-filters"))
    expect(screen.getByTestId("post-filters-views").textContent).toContain(
      "not ≥ 1K",
    )
  })
})

describe("the Channel posts bounds (PTI-02)", () => {
  const NUMBERS = [
    "Views",
    "Estimated views",
    "Channel posts in window",
    "Channel posts in filtered window",
  ]

  test("the Filters menu and the condition picker list the same four numbers, in order", () => {
    // The filter row, and its "+", shows once the filter holds anything.
    mount({ postFilter: addPostFunnel(emptyPostFilter(), "type", "original") })
    fireEvent.click(screen.getByTestId("post-filters"))
    const menu = screen
      .getAllByTestId(/^post-filters-/)
      .map((b) => b.firstChild?.textContent)
    expect(menu).toEqual(NUMBERS)
    fireEvent.click(screen.getByTestId("post-filters"))
    fireEvent.click(screen.getByRole("button", { name: "Add a condition" }))
    const numbers = screen.getByText("Numbers").parentElement as HTMLElement
    const picker = within(numbers)
      .getAllByRole("button")
      .map((b) => b.textContent)
    expect(picker).toEqual(NUMBERS)
  })

  test("each Filters menu row carries its symbol: views an eye, counts # (TB-03)", () => {
    mount()
    fireEvent.click(screen.getByTestId("post-filters"))
    const symbols = screen
      .getAllByTestId(/^post-filters-/)
      .map((b) => b.querySelector("svg")?.getAttribute("class"))
    expect(
      symbols.map((c) => /lucide-(eye|hash)\b/.exec(c ?? "")?.[1]),
    ).toEqual(["eye", "eye", "hash", "hash"])
  })

  test("the pill counts every number bound, Channel posts included", () => {
    const bound = (cond: PostCond) => ({
      kind: "atom" as const,
      id: JSON.stringify(cond),
      not: false,
      cond,
    })
    mount({
      postFilter: {
        ...emptyPostFilter(),
        children: [
          bound({ type: "views", measure: "views", min: 1000 }),
          bound({ type: "channel_posts", max: 5 }),
          bound({ type: "channel_posts_filtered", min: 2 }),
        ],
      },
    })
    expect(screen.getByTestId("post-filters").textContent).toContain("3")
    fireEvent.click(screen.getByTestId("post-filters"))
    expect(
      screen.getByTestId("post-filters-channel_posts").textContent,
    ).toContain("≤ 5")
    expect(
      screen.getByTestId("post-filters-channel_posts_filtered").textContent,
    ).toContain("≥ 2")
  })

  /** 0 to 49.6 in 32 bars of 1.55 Channels' counts. */
  const COUNTS: PostValueHistogramResponse = {
    bins: Array.from({ length: 32 }, (_, i) => i + 1),
    edges: Array.from({ length: 33 }, (_, i) => i * 1.55),
    log: false,
    median: 12,
    min: 0,
    max: 49.6,
    measured: 40,
    total: 40,
  }

  test("a drag on Channel posts in window rounds to a whole channel_posts bound", () => {
    const asked: PostNumber[] = []
    const read = (measure: PostNumber) => {
      asked.push(measure)
      return COUNTS
    }
    const { calls } = mount({}, {}, ({ children }) => (
      <PostValueHistogramContext.Provider value={read}>
        {children}
      </PostValueHistogramContext.Provider>
    ))
    fireEvent.click(screen.getByTestId("post-filters"))
    fireEvent.click(screen.getByTestId("post-filters-channel_posts"))
    expect(asked).toContain("channel_posts")
    expect(screen.queryByRole("button", { name: "no value" })).toBeNull()
    fireEvent.pointerEnter(screen.getByTestId("spread-bar-2"))
    expect(screen.getByTestId("spread-caption").textContent).toContain(
      "3 channels",
    )
    // Bars 0-3 end at 6.2, which is at most 6.
    fireEvent.pointerDown(screen.getByTestId("spread-bar-0"))
    for (const i of [1, 2, 3])
      fireEvent.pointerEnter(screen.getByTestId(`spread-bar-${i}`))
    fireEvent.pointerUp(screen.getByTestId("spread-bar-3"))
    fireEvent.click(screen.getByTestId("number-bound-submit"))
    expect(calls).toEqual([["filter", "channel_posts <= 6"]])
  })

  test("a range with no whole number in it cannot be added; one with one is rounded in", () => {
    const { calls } = mount()
    fireEvent.click(screen.getByTestId("post-filters"))
    fireEvent.click(screen.getByTestId("post-filters-channel_posts_filtered"))
    fireEvent.click(screen.getByRole("button", { name: "between" }))
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "3.2" },
    })
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "3.8" } })
    const submit = () =>
      screen.getByTestId("number-bound-submit") as HTMLButtonElement
    expect(submit().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2.5" },
    })
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "30.5" } })
    fireEvent.click(submit())
    expect(calls).toEqual([["filter", "channel_posts_filtered 3..30"]])
  })
})

describe("the number filters' histograms", () => {
  /** 0 to 3,200 in 32 bars of 100, linear, as the read would answer. */
  const LINEAR: PostValueHistogramResponse = {
    bins: Array.from({ length: 32 }, (_, i) => i + 1),
    edges: Array.from({ length: 33 }, (_, i) => i * 100),
    log: false,
    median: 1600,
    min: 0,
    max: 3200,
    measured: 528,
    total: 600,
  }
  const EMPTY: PostValueHistogramResponse = {
    bins: [],
    edges: [],
    log: false,
    median: null,
    min: null,
    max: null,
    measured: 0,
    total: 0,
  }

  function withHistogram(answer: PostValueHistogramResponse) {
    const asked: string[] = []
    const zooms: (ValueHistogramZoom | null | undefined)[] = []
    const read = (measure: ViewMeasure, zoom?: ValueHistogramZoom | null) => {
      asked.push(measure)
      zooms.push(zoom)
      // Zoomed, the server's bars span the zoom; the rest stays whole.
      if (!zoom) return answer
      const step = (zoom.hi - zoom.lo) / 32
      return {
        ...answer,
        edges: Array.from({ length: 33 }, (_, i) => zoom.lo + i * step),
      }
    }
    return {
      asked,
      zoomed: () => zooms.at(-1) ?? null,
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <PostValueHistogramContext.Provider value={read}>
          {children}
        </PostValueHistogramContext.Provider>
      ),
    }
  }

  const bar = (i: number) => screen.getByTestId(`spread-bar-${i}`)
  const drag = (from: number, to: number) => {
    fireEvent.pointerDown(bar(from))
    for (let i = from; i !== to; i += Math.sign(to - from)) {
      fireEvent.pointerEnter(bar(i + Math.sign(to - from)))
    }
    fireEvent.pointerUp(bar(to))
  }

  test("a drag from the first bar fills an at most bound on Views", () => {
    const { asked, wrapper } = withHistogram(LINEAR)
    const { calls } = mount({}, {}, wrapper)
    fireEvent.click(screen.getByTestId("post-filters"))
    fireEvent.click(screen.getByTestId("post-filters-views"))
    expect(asked).toContain("views")
    expect(screen.getByTestId("spread-caption").textContent).toContain(
      "median 1.6K",
    )
    drag(0, 3)
    fireEvent.click(screen.getByTestId("number-bound-submit"))
    expect(calls).toEqual([["filter", "views <= 400"]])
  })

  test("Views counts the window's Posts with no value, and refuses a negative field", () => {
    const { wrapper } = withHistogram(LINEAR)
    mount({}, {}, wrapper)
    fireEvent.click(screen.getByTestId("post-filters"))
    fireEvent.click(screen.getByTestId("post-filters-views"))
    expect(screen.getByText(/72 have no value/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "-1" },
    })
    expect(
      (screen.getByTestId("number-bound-submit") as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  test("Estimated views reads its own measure, and typing redraws the solid bars", () => {
    const { asked, wrapper } = withHistogram(LINEAR)
    mount({}, {}, wrapper)
    fireEvent.click(screen.getByTestId("post-filters"))
    fireEvent.click(screen.getByTestId("post-filters-estimated"))
    expect(asked).toContain("estimated")
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "2000" },
    })
    expect(bar(19).getAttribute("data-solid")).toBe("false")
    expect(bar(20).getAttribute("data-solid")).toBe("true")
    expect(bar(31).getAttribute("data-solid")).toBe("true")
  })

  test("Zoom in asks for a third around the median, on the scale first drawn (TB-04)", () => {
    const { zoomed, wrapper } = withHistogram(LINEAR)
    mount({}, {}, wrapper)
    fireEvent.click(screen.getByTestId("post-filters"))
    fireEvent.click(screen.getByTestId("post-filters-views"))
    expect(zoomed()).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    // 0 to 3,200 in thirds around 1,600.
    const asked = zoomed()
    expect(asked?.log).toBe(false)
    expect(asked?.lo).toBeCloseTo(1066.67, 1)
    expect(asked?.hi).toBeCloseTo(2133.33, 1)
    // The bars are the zoom's and the caption follows; the median is whole.
    expect(screen.getByTestId("spread-caption").textContent).toBe(
      "1.07Kmedian 1.6K2.13K",
    )
    // The first zoomed bar starts past the whole spread's lowest value.
    drag(0, 3)
    expect(
      screen
        .getAllByRole("button", { pressed: true })
        .map((b) => b.textContent),
    ).toEqual(["between"])
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }))
    expect(zoomed()).toBeNull()
  })

  test("a log spread carries its scale, centred on the bound", () => {
    const { zoomed, wrapper } = withHistogram({
      ...LINEAR,
      edges: Array.from({ length: 33 }, (_, i) => Math.expm1(i / 4)),
      log: true,
      max: Math.expm1(8),
    })
    mount(
      {
        postFilter: {
          ...emptyPostFilter(),
          children: [
            {
              kind: "atom",
              id: "v",
              not: false,
              cond: { type: "views", measure: "views", min: 99 },
            },
          ],
        },
      },
      {},
      wrapper,
    )
    const chip = screen.getByTestId("post-filter-chip-views-views")
    fireEvent.click(within(chip).getByText(/Views/))
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    // A third of log(1 + x)'s 8 around log(100) = 4.61: 2.65 to 5.27.
    const asked = zoomed()
    expect(asked?.log).toBe(true)
    expect(asked?.lo).toBeCloseTo(Math.expm1(Math.log(100) - 4 / 3), 6)
    expect(asked?.hi).toBeCloseTo(Math.expm1(Math.log(100) + 4 / 3), 6)
  })

  test("a window with nothing measured says so instead of drawing bars", () => {
    const { wrapper } = withHistogram(EMPTY)
    mount({}, {}, wrapper)
    fireEvent.click(screen.getByTestId("post-filters"))
    fireEvent.click(screen.getByTestId("post-filters-views"))
    expect(screen.queryByTestId("spread-bar-0")).toBeNull()
    expect(screen.getByText(/Nothing has a value yet/)).toBeTruthy()
  })

  test("the filter row's condition picker opens on the same histogram", () => {
    const { wrapper } = withHistogram(LINEAR)
    mount(
      {
        postFilter: {
          ...emptyPostFilter(),
          children: [
            {
              kind: "atom",
              id: "v",
              not: false,
              cond: { type: "views", measure: "views", min: 1000 },
            },
          ],
        },
      },
      {},
      wrapper,
    )
    const chip = screen.getByTestId("post-filter-chip-views-views")
    fireEvent.click(within(chip).getByText(/Views/))
    expect(bar(10).getAttribute("data-solid")).toBe("true")
    expect(bar(9).getAttribute("data-solid")).toBe("false")
  })
})

describe("the pills", () => {
  test("Sort searches Post date, Views and Estimated views, and keeps its direction", () => {
    const { calls } = mount({ postSortOrder: "oldest" })
    fireEvent.click(screen.getByTestId("post-sort"))
    fireEvent.change(screen.getByPlaceholderText("Search sort options..."), {
      target: { value: "views" },
    })
    expect(
      screen.getAllByRole("radio").map((radio) => radio.textContent),
    ).toEqual(["○ Views", "○ Estimated views"])
    // Ascending dates become fewest views, read on the measure picked.
    fireEvent.click(screen.getByRole("radio", { name: "○ Views" }))
    expect(calls).toEqual([
      ["measure", "views"],
      ["order", "fewest_views"],
    ])
  })

  test("the arrow flips the direction and keeps the measure", () => {
    const { calls } = mount({
      postSortOrder: "most_views",
      viewMeasure: "views",
    })
    expect(screen.getByTestId("post-sort").textContent).toContain("Views")
    fireEvent.click(screen.getByRole("button", { name: "Sort descending" }))
    expect(calls).toEqual([
      ["measure", "views"],
      ["order", "fewest_views"],
    ])
  })

  test("Per channel takes a typed number, a shortcut and Random", () => {
    const { calls } = mount({ maxPostsPerChannel: 3 })
    fireEvent.click(screen.getByTestId("post-filter-pill-cap"))
    expect(screen.getByText("The 3 most recent")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Posts from each channel"), {
      target: { value: "1,000" },
    })
    fireEvent.click(screen.getByText("20"))
    fireEvent.click(screen.getByLabelText("More"))
    fireEvent.click(screen.getByText("No limit"))
    fireEvent.click(screen.getByText("Random"))
    expect(calls).toEqual([
      ["cap", 1000],
      ["cap", 20],
      ["cap", 4],
      ["cap", 0],
      ["capMode", "random"],
    ])
  })

  test("Grouped by channel is a toggle", () => {
    const { calls } = mount({ groupByChannel: true })
    fireEvent.click(screen.getByRole("button", { name: /Grouped by channel/ }))
    expect(calls).toEqual([["grouped", false]])
  })
})

describe("the filter row", () => {
  test("is not there while nothing filters, and says N of the window's M when something does", () => {
    mount()
    expect(screen.queryByTestId("post-filter-row")).toBeNull()
    cleanup()
    mount({ postFilter: funnels(["language", "fa"]) })
    expect(screen.getByTestId("post-filter-count").textContent).toBe(
      "1234 of 5000",
    )
  })

  test("counts are approximate until the window's total is known", () => {
    mount({ postFilter: funnels(["language", "fa"]) }, { facets: undefined })
    const count = screen.getByTestId("post-filter-count")
    expect(count.textContent).toBe("≈ 1234 of 1234")
    expect(count.getAttribute("title")).toContain("has not loaded")
  })

  test("negates a chip, and its label reopens its picker on that Condition", () => {
    const { calls } = mount({ postFilter: funnels(["language", "fa"]) })
    fireEvent.click(screen.getByLabelText("Negate Persian"))
    const chip = screen.getByTestId("post-filter-chip-language-fa")
    fireEvent.click(within(chip).getByText("Persian"))
    fireEvent.click(screen.getByText("No words"))
    expect(calls).toEqual([
      ["filter", "not lang:fa"],
      ["filter", "lang:zxx"],
    ])
  })

  test("the + adds any Condition, a Channel among them", () => {
    const { calls } = mount({ postFilter: funnels(["media", "photo"]) })
    fireEvent.click(screen.getByLabelText("Add a condition"))
    fireEvent.click(screen.getByText("Channel"))
    fireEvent.click(screen.getByText("@durov"))
    expect(calls).toEqual([["filter", "media:photo and channel:durov"]])
  })

  test("shows the keyword as a chip, and Clear all clears it and the filter", () => {
    const { calls } = mount(
      { postFilter: funnels(["type", "original"]) },
      { postSearch: "rates" },
    )
    expect(screen.getByText(/"rates"/)).toBeTruthy()
    expect(
      screen.getByTestId("post-filter-chip-type-original").textContent,
    ).toContain("Original")
    fireEvent.click(screen.getByText("Clear all"))
    expect(calls).toEqual([
      ["keyword", ""],
      ["filter", ""],
    ])
  })
})

describe("the footer", () => {
  test("says how many Posts, and drops one filter per chip", () => {
    const { calls } = mount(
      { maxPostsPerChannel: 5 },
      { subtitle: "(grouped by channel)" },
    )
    expect(screen.getByText("1,234 posts")).toBeTruthy()
    expect(screen.getByText("(grouped by channel)")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Remove Newest 5 per channel"))
    expect(calls).toEqual([["cap", 0]])
  })

  test("says how many Posts were too new to judge, when any were", () => {
    mount({}, { tooNewToJudge: 42 })
    expect(screen.getByText("42 too new to judge")).toBeTruthy()
    cleanup()
    mount()
    expect(screen.queryByText(/too new to judge/)).toBeNull()
  })
})
