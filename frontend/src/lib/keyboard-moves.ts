/**
 * How keyboard mode moves its highlight, on the Posts feed and the Channels
 * grid alike: j and k step one card in reading order whatever the column
 * count, G jumps to the last card and gg to the first. Nothing moves past
 * either end.
 */
export type Move = "j" | "k" | "first" | "last"

/** Two g presses closer than this are gg. */
export const GG_MS = 600

export function nextIndex(at: number, move: Move, count: number): number {
  if (move === "first") return 0
  if (move === "last") return count - 1
  return Math.max(0, Math.min(count - 1, at + (move === "j" ? 1 : -1)))
}

/**
 * The move a key makes, if any. `lastG` is when an unanswered g was pressed,
 * 0 for none; keep the returned one for the next key.
 */
export function readMove(
  key: string,
  now: number,
  lastG: number,
): { move: Move | null; lastG: number } {
  if (key === "j" || key === "k") return { move: key, lastG: 0 }
  if (key === "G") return { move: "last", lastG: 0 }
  if (key !== "g") return { move: null, lastG: 0 }
  if (lastG > 0 && now - lastG < GG_MS) return { move: "first", lastG: 0 }
  return { move: null, lastG: now }
}
