/**
 * The Posts filter bar (PFB-02), rendered props-only so it needs no providers
 * and no `mock.module` (process-wide in bun, see `DataContext.test.tsx`). What
 * is pinned is what an Account can do on it: search by keyword or by meaning,
 * read every pill's value, tick through the forms, and drop filters from the
 * footer.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
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
  // Updaters are applied to the current value, so a call records the result.
  const apply =
    <T,>(name: string, current: T) =>
    (update: React.SetStateAction<T>): void => {
      calls.push([
        name,
        typeof update === "function"
          ? (update as (previous: T) => T)(current)
          : update,
      ])
    }
  const base = {
    semanticSearchQuery: "",
    semanticSearchRespectsChannels: true,
    relatedPostSearch: null,
    forwardedFilter: "all" as const,
    mediaFilter: [],
    languageFilter: [],
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
    setForwardedFilter: log("forwarded"),
    setMediaFilter: apply("media", base.mediaFilter),
    setLanguageFilter: apply("languages", base.languageFilter),
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
      controls={controls(calls, over)}
      embeddingsEnabled={false}
      windowControl={<span>window</span>}
      facets={{
        languages: [
          { value: "fa", count: 120 },
          { value: "zxx", count: 9 },
        ],
        media: [{ value: "photo", count: 55 }],
      }}
      channelLanguages={[]}
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

describe("the pills", () => {
  test("each reads its value, and the defaults read as defaults", () => {
    mount({
      mediaFilter: ["photo", "video"],
      languageFilter: ["zxx"],
      maxPostsPerChannel: 10,
      postSortOrder: "oldest",
    })
    expect(screen.getByTestId("post-filter-pill-type").textContent).toContain(
      "All posts",
    )
    expect(screen.getByTestId("post-filter-pill-media").textContent).toContain(
      "2 selected",
    )
    expect(
      screen.getByTestId("post-filter-pill-language").textContent,
    ).toContain("No text")
    expect(screen.getByTestId("post-filter-pill-order").textContent).toContain(
      "Oldest first",
    )
    expect(screen.getByTestId("post-filter-pill-cap").textContent).toContain(
      "Oldest 10",
    )
  })

  test("Media ticks a kind, with its count, and asks for counts on open", () => {
    const { calls, opened } = mount()
    fireEvent.click(screen.getByTestId("post-filter-pill-media"))
    expect(opened).toEqual([true])
    expect(screen.getByText("55")).toBeTruthy()
    fireEvent.click(screen.getByTestId("post-media-filter-photo"))
    expect(calls).toEqual([["media", ["photo"]]])
  })

  test("Language lists what is present with its count, and resets", () => {
    const { calls } = mount({ languageFilter: ["fa"] })
    fireEvent.click(screen.getByTestId("post-filter-pill-language"))
    expect(screen.getByText("No text")).toBeTruthy()
    expect(screen.getByText("120")).toBeTruthy()
    fireEvent.click(screen.getByText("Any language"))
    expect(calls).toEqual([["languages", []]])
  })

  test("Type and Order are one choice each", () => {
    const { calls } = mount()
    fireEvent.click(screen.getByTestId("post-filter-pill-type"))
    fireEvent.click(
      screen.getByRole("radio", { name: /Forwarded from unfollowed channels/ }),
    )
    fireEvent.click(screen.getByTestId("post-filter-pill-order"))
    fireEvent.click(screen.getByRole("radio", { name: /Oldest first/ }))
    expect(calls).toEqual([
      ["forwarded", "unfollowed_forwarded"],
      ["order", "oldest"],
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

describe("the footer", () => {
  test("says how many Posts, and drops one filter per chip", () => {
    const { calls } = mount(
      { mediaFilter: ["photo"] },
      { subtitle: "(grouped by channel)" },
    )
    expect(screen.getByText("1,234 posts")).toBeTruthy()
    expect(screen.getByText("(grouped by channel)")).toBeTruthy()
    expect(screen.queryByText("Clear all")).toBeNull()
    fireEvent.click(screen.getByLabelText("Remove Photo"))
    expect(calls).toEqual([["media", []]])
  })

  test("Clear all once two or more are on", () => {
    const { calls } = mount(
      { forwardedFilter: "original", maxPostsPerChannel: 5 },
      { postSearch: "rates" },
    )
    fireEvent.click(screen.getByText("Clear all"))
    expect(calls).toEqual([
      ["keyword", ""],
      ["forwarded", "all"],
      ["cap", 0],
    ])
  })
})
