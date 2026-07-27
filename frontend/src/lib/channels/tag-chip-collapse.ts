/**
 * Collapse rules for the channel tag-chip wall.
 *
 * On a real account the wall is not a row, it is a screen: 85 chips measured
 * 489px tall on staging, which pushed the first channel card to y=1040 in an
 * 853px viewport — so the Channels tab opened with *no channel visible at all*.
 * It also scales the wrong way, growing as channels are followed (357px at 43
 * active channels, 489px at 59).
 *
 * Collapsing to a few rows keeps the filter discoverable without letting it
 * displace the content it filters.
 */

/**
 * Roughly three rows: chips are ~26px tall with an 8px gap.
 *
 * A height cap rather than a chip-count cap on purpose — chip widths vary with
 * tag name length, so "first N chips" does not bound the height, and the height
 * is the actual defect.
 */
export const COLLAPSED_TAG_WALL_MAX_PX = 92

/** `Show all 85 tags` / `Show fewer`. */
export function tagWallToggleLabel(total: number, expanded: boolean): string {
  if (expanded) return "Show fewer"
  return `Show all ${total} ${total === 1 ? "tag" : "tags"}`
}

/**
 * Whether the collapsed wall is actually hiding anything.
 *
 * Compared with a 1px tolerance because sub-pixel layout can make `scrollHeight`
 * exceed `clientHeight` by a fraction on a list that visually fits, which would
 * otherwise show a toggle that expands to no change.
 */
export function isTagWallOverflowing(
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight > clientHeight + 1
}
