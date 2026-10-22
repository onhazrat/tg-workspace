/**
 * The list's three forms: one column under day headings while sorted by
 * Written, one ungrouped column under the window sort, and the Compact grid,
 * which has no headings.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import type { ArtifactListItem } from "@/types"
import type { ArtifactActions } from "./ArtifactCardParts"
import { HistoryList } from "./HistoryList"

afterEach(cleanup)

const NOW = new Date(2026, 9, 22, 12).getTime()
const HOUR = 3_600_000
const rows = [
  { kind: "chat", id: "a", timestamp: NOW - HOUR },
  { kind: "chat", id: "b", timestamp: NOW - 2 * HOUR },
  { kind: "tag", id: "c", timestamp: NOW - 30 * HOUR },
] as ArtifactListItem[]

const actions = {
  open: mock(),
  star: mock(),
  saveNote: mock(),
  remove: mock(),
  autoRegenerate: mock(),
  autoPublish: mock(),
  useScope: mock(),
} satisfies ArtifactActions

function mount(days: boolean, compact: boolean) {
  render(
    <HistoryList
      rows={rows}
      actions={actions}
      search=""
      compact={compact}
      days={days}
      now={NOW}
    />,
  )
}

const headings = () =>
  screen.queryAllByTestId("history-day").map((h) => h.textContent)

describe("HistoryList", () => {
  test("sorted by Written, cards sit under day headings with no count", () => {
    mount(true, false)
    expect(headings()).toEqual(["Today", "Yesterday"])
    expect(
      screen
        .getByRole("region", { name: "Today" })
        .querySelectorAll("[data-testid=artifact-card]").length,
    ).toBe(2)
  })

  test("under another sort the cards are one ungrouped list", () => {
    mount(false, false)
    expect(headings()).toEqual([])
    expect(screen.getAllByTestId("artifact-card").length).toBe(3)
  })

  test("the Compact grid has no headings, and its cards are compact", () => {
    mount(true, true)
    expect(headings()).toEqual([])
    expect(screen.getAllByTestId("artifact-card").length).toBe(3)
    expect(screen.queryByTestId("artifact-scope-line")).toBeNull()
  })
})
