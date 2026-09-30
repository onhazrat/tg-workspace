/**
 * Row 1's small controls and row 2 (CTB-01), rendered props-only: what an
 * Account reads on each and what a click asks for.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ChannelSettingGroup } from "@/types"
import {
  AiContextPill,
  CardSizeSwitch,
  FollowControl,
  SortMenu,
} from "./ChannelBarControls"
import {
  ChannelSelectionBar,
  type ChannelSelectionBarProps,
} from "./ChannelSelectionBar"

afterEach(cleanup)

type Calls = [string, unknown][]
// A handler wired straight to onClick receives the click event; drop it.
const logger = (calls: Calls) => (name: string) => (value?: unknown) => {
  calls.push([name, typeof value === "object" ? undefined : value])
}

describe("FollowControl", () => {
  test("follows the typed handle, and only once one is typed", () => {
    const calls: Calls = []
    const log = logger(calls)
    const { rerender } = render(
      <FollowControl
        value=""
        onChange={log("change")}
        onFollow={log("follow")}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Follow/ }))
    const submit = screen.getAllByRole("button", { name: "Follow" }).at(-1)
    expect(submit?.hasAttribute("disabled")).toBe(true)
    fireEvent.change(screen.getByLabelText("Channel to follow"), {
      target: { value: "durov" },
    })
    rerender(
      <FollowControl
        value="durov"
        onChange={log("change")}
        onFollow={log("follow")}
      />,
    )
    fireEvent.submit(screen.getByLabelText("Channel to follow"))
    expect(calls).toEqual([
      ["change", "durov"],
      ["follow", undefined],
    ])
  })
})

describe("SortMenu", () => {
  const mount = (showSubscribers: boolean, calls: Calls = []) => {
    const log = logger(calls)
    render(
      <SortMenu
        sortBy="reach"
        onSortByChange={log("sort")}
        sortDirection="asc"
        onToggleSortDirection={log("direction")}
        showSubscribers={showSubscribers}
      />,
    )
    fireEvent.click(screen.getByTestId("channel-sort"))
  }

  test("names the sort, offers Subscribers only when shown, and searches", () => {
    mount(false)
    expect(screen.getByTestId("channel-sort").textContent).toContain("Reach")
    expect(screen.queryByRole("radio", { name: /Subscribers/ })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText("Search sort options..."), {
      target: { value: "sync" },
    })
    expect(screen.getAllByRole("radio")).toHaveLength(3)
    cleanup()
    mount(true)
    expect(screen.getByRole("radio", { name: /Subscribers/ })).toBeTruthy()
  })

  test("picks an option and flips the direction", () => {
    const calls: Calls = []
    mount(false, calls)
    fireEvent.click(screen.getByRole("radio", { name: /Total posts/ }))
    fireEvent.click(screen.getByRole("button", { name: "Sort ascending" }))
    expect(calls).toEqual([
      ["sort", "total_posts"],
      ["direction", undefined],
    ])
  })
})

describe("AiContextPill", () => {
  test("counts the settings that are on and toggles each", () => {
    const calls: Calls = []
    const log = logger(calls)
    render(
      <AiContextPill
        includeBio={false}
        onIncludeBioChange={log("bio")}
        includeTags
        onIncludeTagsChange={log("tags")}
      />,
    )
    const pill = screen.getByTestId("channel-ai-context")
    expect(pill.textContent?.trim()).toBe("AI context1")
    expect(pill.getAttribute("data-active")).toBe("true")
    fireEvent.click(pill)
    fireEvent.click(screen.getByLabelText("Channel bio"))
    expect(calls).toEqual([["bio", true]])
  })

  test("is plain with nothing on", () => {
    render(
      <AiContextPill
        includeBio={false}
        onIncludeBioChange={() => {}}
        includeTags={false}
        onIncludeTagsChange={() => {}}
      />,
    )
    expect(screen.getByTestId("channel-ai-context").textContent?.trim()).toBe(
      "AI context",
    )
  })
})

describe("CardSizeSwitch", () => {
  test("marks the current size and switches to any of four", () => {
    const sizes: number[] = []
    render(<CardSizeSwitch zoom={-1} onZoomChange={(z) => sizes.push(z)} />)
    expect(
      screen
        .getByRole("button", { name: "Compact cards" })
        .getAttribute("aria-pressed"),
    ).toBe("true")
    for (const name of ["Tiles", "Cards", "Detailed cards"]) {
      fireEvent.click(screen.getByRole("button", { name }))
    }
    expect(sizes).toEqual([-2, 0, 1])
  })
})

describe("ChannelSelectionBar", () => {
  const groups = [
    { id: "g1", name: "Default", isDefault: true },
    { id: "g2", name: "Slow" },
  ] as ChannelSettingGroup[]

  const shown = Array.from({ length: 12 }, (_, i) => `c${i}`)
  const selecting = (n: number) => new Set(shown.slice(0, n))

  function mount(over: Partial<ChannelSelectionBarProps> = {}) {
    const calls: Calls = []
    const log = logger(calls)
    render(
      <ChannelSelectionBar
        selection={new Set()}
        shown={shown}
        onSelectAll={log("all")}
        onSetSelection={log("set")}
        actionLimit="shown"
        onActionLimitChange={log("limit")}
        actionCount={over.selection?.size ?? 0}
        onClear={log("clear")}
        trimCount="3"
        onTrimCountChange={log("trimCount")}
        onTrim={log("trim")}
        isTrimDisabled={false}
        onSync={log("sync")}
        isSyncDisabled={false}
        isSyncing={false}
        onFreeze={log("freeze")}
        onUnfreeze={log("unfreeze")}
        onDelete={log("delete")}
        settingGroups={groups}
        moveTargetId="g1"
        onMoveTargetChange={log("target")}
        onMove={log("move")}
        tagInput="news"
        onTagInputChange={log("tagInput")}
        onAddTag={log("addTag")}
        removeTagInput=""
        onRemoveTagInputChange={log("removeInput")}
        onRemoveTag={log("removeTag")}
        groupBySelection
        onToggleGroupBySelection={log("grouping")}
        showSortRank={false}
        onShowSortRankChange={log("rank")}
        zoom={0}
        onZoomChange={log("zoom")}
        {...over}
      />,
    )
    return calls
  }

  test("with nothing selected: the count and Select all, no bulk actions", () => {
    const calls = mount()
    expect(screen.getByTestId("channel-selection-summary").textContent).toBe(
      "12 channels",
    )
    expect(screen.queryByTestId("channel-trim-button")).toBeNull()
    expect(screen.queryByTestId("adjust-selection")).toBeNull()
    expect(screen.queryByText("Delete")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Select all" }))
    expect(calls.map(([name]) => name)).toEqual(["all"])
  })

  test("with a selection: the count clears it, and the bulk actions reach it", () => {
    const calls = mount({ selection: selecting(5) })
    expect(screen.getByText("5 selected")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "All" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Invert" })).toBeNull()
    expect(screen.getByTestId("adjust-selection")).toBeTruthy()
    expect(screen.queryByTestId("action-limit-indicator")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
    fireEvent.click(screen.getByTestId("channel-trim-button"))
    fireEvent.click(screen.getByRole("button", { name: "Sync" }))
    fireEvent.click(screen.getByRole("button", { name: "Freeze" }))
    fireEvent.click(screen.getByRole("button", { name: "Unfreeze" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(calls.map(([name]) => name)).toEqual([
      "clear",
      "trim",
      "sync",
      "freeze",
      "unfreeze",
      "delete",
    ])
  })

  test("moves to the chosen Setting group from a popover", () => {
    const calls = mount({ selection: selecting(1) })
    fireEvent.click(screen.getByRole("button", { name: /Move to group/ }))
    expect(screen.getByText("Move 1 channel to")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Slow" }))
    fireEvent.click(screen.getByRole("button", { name: "Move" }))
    expect(calls).toEqual([
      ["target", "g2"],
      ["move", undefined],
    ])
  })

  test("adds and removes tags from a popover", () => {
    const calls = mount({ selection: selecting(2) })
    fireEvent.click(screen.getByTestId("bulk-tags"))
    fireEvent.submit(screen.getByTestId("bulk-add-tag-input"))
    expect(
      screen.getByTestId("bulk-remove-tag-button").hasAttribute("disabled"),
    ).toBe(true)
    expect(calls.map(([name]) => name)).toEqual(["addTag"])
  })

  test("keeps the layout toggles and card size in both states", () => {
    for (const n of [0, 3]) {
      const calls = mount({ selection: selecting(n) })
      fireEvent.click(screen.getByRole("button", { name: /Selected first/ }))
      fireEvent.click(screen.getByTestId("channel-show-sort-rank"))
      expect(screen.getByRole("group", { name: "Card size" })).toBeTruthy()
      expect(calls).toEqual([
        ["grouping", undefined],
        ["rank", true],
      ])
      cleanup()
    }
  })

  test("with part of the selection hidden, says so and counts the shown part", () => {
    // Two selected and shown, three selected and hidden by the filters.
    const selection = new Set(["c0", "c1", "h0", "h1", "h2"])
    const calls = mount({ selection, actionCount: 2 })
    expect(screen.getByText("5 selected")).toBeTruthy()
    const indicator = screen.getByTestId("action-limit-indicator")
    expect(indicator.textContent).toBe("acting on 2 shown")
    expect(screen.getByText("shown")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Move to group/ }))
    expect(screen.getByText("Move 2 channels to")).toBeTruthy()
    fireEvent.click(indicator)
    expect(calls).toEqual([["limit", "all"]])
  })

  test("on All, Trim reads plain and the indicator turns amber", () => {
    const selection = new Set(["c0", "h0"])
    mount({ selection, actionLimit: "all", actionCount: 2 })
    expect(screen.getByTestId("action-limit-indicator").textContent).toBe(
      "1 hidden by filters",
    )
    expect(screen.queryByText("shown")).toBeNull()
  })
})
