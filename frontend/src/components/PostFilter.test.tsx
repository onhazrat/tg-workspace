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
import {
  addPostFunnel,
  emptyPostFilter,
  type PostFilter,
  printPostFilter,
} from "@/lib/posts/post-filter"
import {
  type FilterBarControls,
  PostFilterBar,
  type PostFilterBarProps,
} from "./PostFilter"

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
  props: Partial<PostFilterBarProps> = {},
) {
  const calls: Calls = []
  const opened: boolean[] = []
  render(
    <PostFilterBar
      postSearch=""
      setPostSearch={(value) => calls.push(["keyword", value])}
      shownCount={1234}
      subtitle=""
      tooNewToJudge={0}
      estimationFloorHours={3}
      controls={controls(calls, over)}
      embeddingsEnabled={false}
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
      "No text",
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
    expect(screen.getByText("No text")).toBeTruthy()
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

  test("select a value not fully selected, deselect one that is", () => {
    const { calls } = mount()
    fireEvent.click(screen.getByTestId("post-filter-language"))
    fireEvent.click(tick("language", "fa"))
    fireEvent.click(tick("language", "zxx"))
    cleanup()
    const second = mount()
    fireEvent.click(screen.getByTestId("post-filter-type"))
    fireEvent.click(tick("type", "original"))

    expect(calls).toEqual([
      ["tick", "select language:fa"],
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
    fireEvent.click(screen.getByTestId("post-views-editor-submit"))
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
      screen.getByTestId("post-views-editor-submit") as HTMLButtonElement
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
    fireEvent.click(screen.getByText("No text"))
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
