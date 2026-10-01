/**
 * The selection bar (PTR-05): the count, Select all and Deselect all over
 * what the filter shows, and the steps as chips in order, each removable.
 * Its tools (PTR-06): the Adjust selection Venn over the server's counts, its
 * presets recorded as rules and the one picture rules cannot draw refused;
 * Selected first; Copy links and Export Markdown.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Regions } from "@/lib/channels/selection-regions"
import { addPostFunnel, emptyPostFilter } from "@/lib/posts/post-filter"
import {
  appendSteps,
  DEFAULT_SELECTION,
  EMPTY_SNAPSHOT,
  type PostSelection,
  pick,
  rule,
  type SelectionChip,
  selectionChips,
} from "@/lib/posts/post-selection"
import {
  PostSelectionBar,
  type PostSelectionBarProps,
} from "./PostSelectionBar"

afterEach(cleanup)

const arabic = {
  ...EMPTY_SNAPSHOT,
  tree: addPostFunnel(emptyPostFilter(), "language", "ar"),
}
const steps = appendSteps(DEFAULT_SELECTION, [
  rule(false, arabic),
  pick(false, { channelName: "a", id: 1 }),
  pick(false, { channelName: "a", id: 2 }),
  pick(false, { channelName: "a", id: 3 }),
]) as PostSelection

function bar(over: Partial<PostSelectionBarProps> = {}) {
  const calls: string[] = []
  const removed: SelectionChip[] = []
  const adjusted: Regions[] = []
  render(
    <PostSelectionBar
      selected={1234}
      total={5000}
      chips={selectionChips(steps)}
      ranked={false}
      onSelectAll={() => calls.push("select")}
      onDeselectAll={() => calls.push("deselect")}
      onRemoveChip={(chip) => removed.push(chip)}
      regions={{ hidden: 6, both: 4, fresh: 3 }}
      onAdjust={(keep) => adjusted.push(keep)}
      selectedFirst={false}
      onSelectedFirstChange={(on) => calls.push(`first:${on}`)}
      onCopyLinks={() => calls.push("copy")}
      onExportMarkdown={() => calls.push("export")}
      {...over}
    />,
  )
  return { calls, removed, adjusted }
}

const region = (name: RegExp) => screen.getByRole("checkbox", { name })
const openVenn = () => fireEvent.click(screen.getByTestId("adjust-selection"))

describe("PostSelectionBar", () => {
  test("says how many are selected of the window", () => {
    bar()
    expect(screen.getByText(/selected/).textContent).toBe(
      "1,234 selected of 5,000 in window",
    )
    cleanup()

    bar({ total: undefined })
    expect(screen.getByText(/selected/).textContent).toBe("1,234 selected")
  })

  test("shows the steps in order as chips", () => {
    bar()
    const chips = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent?.replace("then ", ""))
    expect(chips).toEqual(["Select all", "Deselect Arabic", "−3 posts"])
  })

  test("removing a chip names that chip and no other", () => {
    const { removed } = bar()
    fireEvent.click(screen.getByLabelText("Remove Deselect Arabic"))

    expect(removed).toEqual([selectionChips(steps)[1]])
  })

  test("Select all and Deselect all say what they cover", () => {
    const { calls } = bar()
    fireEvent.click(screen.getByText("Select all", { selector: "button" }))
    fireEvent.click(screen.getByText("Deselect all", { selector: "button" }))
    expect(calls).toEqual(["select", "deselect"])
    expect(screen.getByText("Select all", { selector: "button" }).title).toBe(
      "Select what the filter shows",
    )
    cleanup()

    bar({ ranked: true })
    expect(screen.getByText("Deselect all", { selector: "button" }).title).toBe(
      "Deselect these search results",
    )
  })
})

describe("the Venn on Posts", () => {
  test("counts its regions from the server and offers no Invert shown", () => {
    bar()
    openVenn()
    expect(region(/hidden by filters/).getAttribute("aria-label")).toContain(
      ": 6",
    )
    expect(region(/Selected and shown/).getAttribute("aria-label")).toContain(
      ": 4",
    )
    expect(region(/Shown, not selected/).getAttribute("aria-label")).toContain(
      ": 3",
    )
    expect(screen.queryByRole("button", { name: /Invert shown/ })).toBeNull()
    for (const name of [
      /Add shown/,
      /Remove shown/,
      /Keep only shown/,
      /Select only shown/,
    ])
      expect(screen.getByRole("button", { name })).toBeTruthy()
  })

  test("a preset applies as its picture, which the tab records as rules", () => {
    const { adjusted } = bar()
    openVenn()
    fireEvent.click(screen.getByRole("button", { name: /Keep only shown/ }))
    fireEvent.click(screen.getByTestId("adjust-selection-apply"))
    expect(adjusted).toEqual([{ hidden: false, both: true, fresh: false }])
  })

  test("refuses the click that would flip each shown Post", () => {
    const { adjusted } = bar()
    openVenn()
    // Dropping the selected shown Posts is a rule; keeping the unselected
    // ones as well would flip every shown Post, so that click does nothing.
    fireEvent.click(region(/Selected and shown/))
    const fresh = region(/Shown, not selected/)
    expect(fresh.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(fresh)
    expect(fresh.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(screen.getByTestId("adjust-selection-apply"))
    expect(adjusted).toEqual([{ hidden: true, both: false, fresh: false }])
  })

  test("cannot open over a meaning search, and says why", () => {
    bar({ regions: undefined })
    const trigger = screen.getByTestId("adjust-selection")
    expect(trigger.hasAttribute("disabled")).toBe(true)
    expect(trigger.title).toContain("meaning search")
  })
})

describe("Selected first, copy and export", () => {
  test("the switch says its state and flips it", () => {
    const { calls } = bar({ selectedFirst: true })
    const toggle = screen.getByRole("button", { name: /Selected first/ })
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(toggle)
    expect(calls).toEqual(["first:false"])
  })

  test("Copy links and Export Markdown each ask once", () => {
    const { calls } = bar()
    fireEvent.click(screen.getByRole("button", { name: /Copy links/ }))
    fireEvent.click(screen.getByRole("button", { name: /Export Markdown/ }))
    expect(calls).toEqual(["copy", "export"])
  })
})
