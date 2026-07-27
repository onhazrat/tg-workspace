import { describe, expect, it } from "bun:test"
import {
  partitionPreviewRows,
  proposedTagState,
  type TagPreviewRow,
  unchangedToggleLabel,
} from "./tag-preview-rows"

const row = (
  channel: string,
  currentTags: string[],
  proposed: string[],
  toApply: string[],
): TagPreviewRow => ({ channel, currentTags, proposed, toApply })

describe("partitionPreviewRows", () => {
  it("separates rows that do something from rows that do not", () => {
    const { changed, unchanged } = partitionPreviewRows([
      row("a", ["news"], ["news", "tech"], ["tech"]),
      row("b", ["news"], ["news"], []),
      row("c", [], ["war"], ["war"]),
    ])
    expect(changed.map((r) => r.channel)).toEqual(["a", "c"])
    expect(unchanged.map((r) => r.channel)).toEqual(["b"])
  })

  it("keeps the whole set — no row is dropped", () => {
    // The unchanged rows are hidden by default, not discarded; losing one would
    // silently misreport what a run covered.
    const rows = [
      row("a", [], ["x"], ["x"]),
      row("b", ["y"], ["y"], []),
      row("c", ["z"], ["z"], []),
    ]
    const { changed, unchanged } = partitionPreviewRows(rows)
    expect(changed.length + unchanged.length).toBe(rows.length)
  })

  it("handles the all-unchanged run the audit reported", () => {
    // "50 rows of No changes" — the case the default now hides.
    const rows = Array.from({ length: 50 }, (_, i) =>
      row(`ch${i}`, ["news"], ["news"], []),
    )
    const { changed, unchanged } = partitionPreviewRows(rows)
    expect(changed).toHaveLength(0)
    expect(unchanged).toHaveLength(50)
  })
})

describe("unchangedToggleLabel", () => {
  it("says how many are hidden", () => {
    expect(unchangedToggleLabel(47, false)).toBe("Show 47 unchanged channels")
  })

  it("does not say '1 unchanged channels'", () => {
    expect(unchangedToggleLabel(1, false)).toBe("Show 1 unchanged channel")
  })

  it("offers the way back", () => {
    expect(unchangedToggleLabel(47, true)).toBe("Hide unchanged")
  })
})

describe("proposedTagState", () => {
  it("marks a genuinely new tag as being added", () => {
    expect(proposedTagState("tech", ["news"], "add")).toBe("adding")
  })

  it("marks a tag the channel already has as a no-op in add mode", () => {
    expect(proposedTagState("news", ["news"], "add")).toBe("unchanged")
  })

  it("marks a held tag as being removed in remove mode", () => {
    expect(proposedTagState("news", ["news"], "remove")).toBe("removing")
  })

  it("marks an absent tag as a no-op in remove mode", () => {
    expect(proposedTagState("tech", ["news"], "remove")).toBe("unchanged")
  })

  it("compares case-insensitively, matching how toApply is computed", () => {
    // If the highlight used a different comparison from the action, it would
    // colour rows that the run will not touch.
    expect(proposedTagState("News", ["news"], "add")).toBe("unchanged")
    expect(proposedTagState("NEWS", ["news"], "remove")).toBe("removing")
  })

  it("agrees with toApply on the same input", () => {
    // Guards the guard: the highlight and the action must classify identically.
    const currentTags = ["news", "Politics"]
    const proposed = ["news", "tech", "POLITICS"]
    const toApplyAdd = proposed.filter(
      (t) => !currentTags.some((c) => c.toLowerCase() === t.toLowerCase()),
    )
    const highlightedAdding = proposed.filter(
      (t) => proposedTagState(t, currentTags, "add") === "adding",
    )
    expect(highlightedAdding).toEqual(toApplyAdd)
  })
})
