/**
 * The selection bar (PTR-05): the count, Select all and Deselect all over
 * what the filter shows, and the steps as chips in order, each removable.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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
  render(
    <PostSelectionBar
      selected={1234}
      total={5000}
      chips={selectionChips(steps)}
      ranked={false}
      onSelectAll={() => calls.push("select")}
      onDeselectAll={() => calls.push("deselect")}
      onRemoveChip={(chip) => removed.push(chip)}
      {...over}
    />,
  )
  return { calls, removed }
}

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
