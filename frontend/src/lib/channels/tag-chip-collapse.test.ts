import { describe, expect, it } from "bun:test"
import {
  COLLAPSED_TAG_WALL_MAX_PX,
  isTagWallOverflowing,
  tagWallToggleLabel,
} from "./tag-chip-collapse"

describe("tag wall collapse", () => {
  it("caps the wall well below the height that caused the defect", () => {
    // Measured on staging: an 85-chip wall was 489px tall and pushed the first
    // channel card to y=1040 in an 853px viewport.
    expect(COLLAPSED_TAG_WALL_MAX_PX).toBeLessThan(150)
    // Still tall enough to show more than a single row, or the filter stops
    // being browsable.
    expect(COLLAPSED_TAG_WALL_MAX_PX).toBeGreaterThan(50)
  })

  it("leaves room for content in the viewport it was crowding out", () => {
    const previousWallPx = 489
    const viewportPx = 853
    // The whole point: collapsed, the wall must not dominate the viewport.
    expect(COLLAPSED_TAG_WALL_MAX_PX / viewportPx).toBeLessThan(0.2)
    expect(COLLAPSED_TAG_WALL_MAX_PX).toBeLessThan(previousWallPx / 3)
  })

  it("names the count so the toggle says what it will reveal", () => {
    expect(tagWallToggleLabel(85, false)).toBe("Show all 85 tags")
    expect(tagWallToggleLabel(85, true)).toBe("Show fewer")
  })

  it("does not say '1 tags'", () => {
    expect(tagWallToggleLabel(1, false)).toBe("Show all 1 tag")
  })

  it("ignores sub-pixel overflow", () => {
    // A list that visually fits can still report a fractionally larger
    // scrollHeight; without the tolerance the toggle appears and expands to no
    // visible change.
    expect(isTagWallOverflowing(92.4, 92)).toBe(false)
    expect(isTagWallOverflowing(92, 92)).toBe(false)
  })

  it("detects a wall that is genuinely clipped", () => {
    expect(isTagWallOverflowing(489, COLLAPSED_TAG_WALL_MAX_PX)).toBe(true)
    expect(isTagWallOverflowing(120, 92)).toBe(true)
  })
})
