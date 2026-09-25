/**
 * The Tag tab below the apply bar, from props. What is pinned: the scope line
 * and the empty state swap on whether a run is selected, unchanged rows hide
 * behind a toggle, each proposed tag is marked with what applying it would do,
 * and the Action column spells the change in the run's own direction.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { TagPreviewRow } from "@/lib/channels/tag-preview-rows"
import type { TagRun } from "@/types"
import { TagViewBody, type TagViewBodyProps } from "./TagViewBody"

afterEach(cleanup)

const run = { id: "r1", promptText: "the prompt" } as TagRun

const changed: TagPreviewRow = {
  channel: "news",
  currentTags: ["Tech"],
  proposed: ["tech", "ai"],
  toApply: ["ai"],
}
const unchanged: TagPreviewRow = {
  channel: "quiet",
  currentTags: [],
  proposed: [],
  toApply: [],
}

const renderBody = (props: Partial<TagViewBodyProps>) =>
  render(
    <TagViewBody
      rows={[]}
      previewMode="add"
      selectedCount={0}
      selectedRun={null}
      scopeLine={(r) => <p>scope of {r.id}</p>}
      emptyState={<p>nothing yet</p>}
      {...props}
    />,
  )

const channelsShown = () =>
  [...document.querySelectorAll("tbody tr td:first-child")].map(
    (cell) => cell.textContent,
  )

describe("TagViewBody", () => {
  test("no run: the empty state and the paste hint, no scope line", () => {
    renderBody({})
    expect(screen.getByText("nothing yet")).toBeTruthy()
    expect(
      screen.getByText("Generate or paste tag suggestions to preview changes."),
    ).toBeTruthy()
    expect(screen.queryByText(/scope of/)).toBeNull()
  })

  test("a selected run: its scope line and prompt, no empty state", () => {
    renderBody({ selectedRun: run })
    expect(screen.getByText("scope of r1")).toBeTruthy()
    expect(screen.getByText("the prompt")).toBeTruthy()
    expect(screen.queryByText("nothing yet")).toBeNull()
  })

  test("unchanged rows hide behind the toggle and the scope note explains the count", () => {
    renderBody({ rows: [changed, unchanged], selectedCount: 5 })
    expect(screen.getByTestId("tag-preview-scope-note").textContent).toBe(
      "Suggestions cover 2 channels; 5 channels currently selected.",
    )
    expect(channelsShown()).toEqual(["@news"])

    fireEvent.click(screen.getByTestId("tag-preview-unchanged-toggle"))
    expect(channelsShown()).toEqual(["@news", "@quiet"])
    expect(screen.getByText("Hide unchanged")).toBeTruthy()
  })

  test("add marks and prefixes what is added", () => {
    renderBody({ rows: [changed], selectedCount: 1 })
    const states = [...document.querySelectorAll("[data-tag-state]")].map(
      (tag) => `${tag.textContent}:${tag.getAttribute("data-tag-state")}`,
    )
    expect(states).toEqual(["tech:unchanged", "ai:adding"])
    expect(screen.getByText("+ai")).toBeTruthy()
    expect(screen.queryByTestId("tag-preview-unchanged-toggle")).toBeNull()
  })

  test("remove marks and prefixes what is removed", () => {
    renderBody({
      rows: [{ ...changed, toApply: ["tech"] }],
      previewMode: "remove",
      selectedCount: 1,
    })
    const removing = document.querySelector("[data-tag-state='removing']")
    expect(removing?.textContent).toBe("tech")
    expect(screen.getByText("-tech")).toBeTruthy()
  })
})
