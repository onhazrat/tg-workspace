/**
 * The History tab's rules and controls. `HistoryView` keeps the queries and
 * the writes; what is pinned here is when a schedule flag may be switched on,
 * what the empty list and the delete dialog say, and which filter a click sets.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ArtifactListItem } from "@/types"
import {
  ArtifactNoteEditor,
  HistoryKindFilters,
  HistorySearchControls,
} from "./HistoryViewParts"
import {
  deleteDialogCopy,
  historyEmptyDescription,
  historyShowsEmpty,
  kindFilterChip,
  summaryFlagChange,
} from "./history-view-model"

afterEach(cleanup)

const summary = (over: Record<string, unknown> = {}) =>
  ({
    kind: "summary",
    id: "s1",
    title: "",
    timestamp: 1,
    isStarred: false,
    status: "done",
    autoRegenerate: false,
    autoPublish: false,
    scope: { channels: ["alpha", "beta"], durationMinutes: 60 },
    ...over,
  }) as unknown as ArtifactListItem

const chat = {
  kind: "chat",
  id: "c1",
  title: "My chat",
  timestamp: 1,
  isStarred: true,
} as unknown as ArtifactListItem

describe("summaryFlagChange", () => {
  test("only a Summary has schedule flags", () => {
    expect(summaryFlagChange(chat, "autoPublish")).toBeNull()
  })

  test("each flag flips to the opposite of what is stored", () => {
    expect(summaryFlagChange(summary(), "autoPublish")).toEqual({ next: true })
    expect(
      summaryFlagChange(summary({ autoPublish: true }), "autoPublish"),
    ).toEqual({ next: false })
    expect(summaryFlagChange(summary(), "autoRegenerate")).toEqual({
      next: true,
    })
  })

  test("auto-regenerate refuses a window under a minute, or none at all", () => {
    const refusal = {
      refusal:
        "Cannot auto-regenerate a summary whose range is under a minute.",
    }
    const short = summary({ scope: { channels: [], durationMinutes: 0.5 } })
    expect(summaryFlagChange(short, "autoRegenerate")).toEqual(refusal)
    expect(
      summaryFlagChange(summary({ scope: null }), "autoRegenerate"),
    ).toEqual(refusal)
    // Exactly one minute is enough.
    const minute = summary({ scope: { channels: [], durationMinutes: 1 } })
    expect(summaryFlagChange(minute, "autoRegenerate")).toEqual({ next: true })
  })

  test("switching a flag off is never refused, and a short window can still publish", () => {
    const short = { scope: { channels: [], durationMinutes: 0 } }
    expect(
      summaryFlagChange(
        summary({ ...short, autoRegenerate: true }),
        "autoRegenerate",
      ),
    ).toEqual({ next: false })
    expect(summaryFlagChange(summary(short), "autoPublish")).toEqual({
      next: true,
    })
  })
})

describe("historyEmptyDescription", () => {
  const nothingYet =
    "Summaries, chats, tag runs and discovery reports you create will appear here."
  const filtered = "No artifacts match these filters."

  test("any one filter makes the empty list a filtered one", () => {
    expect(historyEmptyDescription("", false, null)).toBe(nothingYet)
    expect(historyEmptyDescription("alpha", false, null)).toBe(filtered)
    expect(historyEmptyDescription("", true, null)).toBe(filtered)
    expect(historyEmptyDescription("", false, "tag")).toBe(filtered)
  })
})

describe("historyShowsEmpty", () => {
  test("only a settled, empty answer is empty", () => {
    expect(historyShowsEmpty(0, false)).toBe(true)
    expect(historyShowsEmpty(0, true)).toBe(false)
    expect(historyShowsEmpty(3, false)).toBe(false)
  })
})

describe("deleteDialogCopy", () => {
  test("names the kind and the channels", () => {
    expect(deleteDialogCopy(summary())).toEqual({
      title: "Delete this Summary?",
      description: "alpha, beta",
    })
  })

  test("falls back when there are no channels, or nothing is pending", () => {
    expect(deleteDialogCopy(chat)).toEqual({
      title: "Delete this Chat?",
      description: "This cannot be undone.",
    })
    expect(
      deleteDialogCopy(summary({ scope: { channels: [] } })).description,
    ).toBe("This cannot be undone.")
    expect(deleteDialogCopy(null).title).toBe("Delete this item?")
  })
})

describe("kindFilterChip", () => {
  test("null is All; a kind is its label", () => {
    expect(kindFilterChip(null)).toEqual({
      label: "All",
      testId: "history-kind-all",
    })
    expect(kindFilterChip("tag")).toEqual({
      label: "Tag run",
      testId: "history-kind-tag",
    })
  })
})

describe("HistoryKindFilters", () => {
  test("the active chip is pressed, and a click selects its kind", () => {
    const onSelect = mock()
    render(<HistoryKindFilters kind="chat" onSelect={onSelect} />)
    expect(
      screen.getByTestId("history-kind-chat").getAttribute("aria-pressed"),
    ).toBe("true")
    expect(
      screen.getByTestId("history-kind-all").getAttribute("aria-pressed"),
    ).toBe("false")
    fireEvent.click(screen.getByText("Discovery"))
    expect(onSelect).toHaveBeenCalledWith("discovery")
    fireEvent.click(screen.getByText("All"))
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})

describe("HistorySearchControls", () => {
  test("typing searches, and the star flips starred-only", () => {
    const onSearchChange = mock()
    const onStarredOnlyChange = mock()
    render(
      <HistorySearchControls
        searchQuery=""
        onSearchChange={onSearchChange}
        starredOnly
        onStarredOnlyChange={onStarredOnlyChange}
      />,
    )
    fireEvent.change(screen.getByLabelText("Search history"), {
      target: { value: "alpha" },
    })
    expect(onSearchChange).toHaveBeenCalledWith("alpha")
    const star = screen.getByLabelText("Show starred only")
    expect(star.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(star)
    expect(onStarredOnlyChange).toHaveBeenCalledWith(false)
  })
})

describe("ArtifactNoteEditor", () => {
  test("names the kind, and edits, cancels and saves through its handlers", () => {
    const h = { onDraftChange: mock(), onCancel: mock(), onSave: mock() }
    render(<ArtifactNoteEditor artifact={chat} draft="keep" {...h} />)
    expect(screen.getByText("Note on Chat")).toBeTruthy()
    const box = screen.getByLabelText("Note on Chat")
    expect((box as HTMLTextAreaElement).value).toBe("keep")
    fireEvent.change(box, { target: { value: "keep this" } })
    expect(h.onDraftChange).toHaveBeenCalledWith("keep this")
    fireEvent.click(screen.getByText("Cancel"))
    expect(h.onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText("Save note"))
    expect(h.onSave).toHaveBeenCalledTimes(1)
  })
})
