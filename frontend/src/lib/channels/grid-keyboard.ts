/**
 * Where keyboard mode's ring goes on the Channels grid. As on the Posts feed,
 * j and k step through the cards one at a time in reading order, whatever the
 * column count; G jumps to the last card and gg to the first. Every move stays
 * inside the list.
 */
export type GridMove = "j" | "k" | "first" | "last"

export function nextRingIndex(at: number, move: GridMove, count: number) {
  if (move === "first") return 0
  if (move === "last") return count - 1
  return Math.max(0, Math.min(count - 1, at + (move === "j" ? 1 : -1)))
}
