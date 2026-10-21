import {
  gLive,
  setGPending,
} from "@/components/directory-photo-prototype/fkeys"
import { variantNow } from "@/components/directory-photo-prototype/variant"
/**
 * How keyboard mode moves its highlight, on the Posts feed and the Channels
 * grid alike: j and k step one card in reading order whatever the column
 * count, G jumps to the last card and gg to the first. Nothing moves past
 * either end.
 */
export type Move = "j" | "k" | "first" | "last"

/** Inputs that take a click, not typing, so a key pressed on one is the page's. */
const CLICKED_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
])

/** Whether focus is in a field a key could be typing into. */
export function focusIsTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el instanceof HTMLInputElement) return !CLICKED_INPUTS.has(el.type)
  return (
    el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable
  )
}

/** Keys belong to the page only when nothing else could be listening for them. */
export function keyBelongsElsewhere(e: KeyboardEvent): boolean {
  // A dialog that closed on this key (Escape) has already claimed it.
  // PROTOTYPE: variant A only.
  if (e.defaultPrevented && variantNow() !== "0") return true
  if (e.metaKey || e.ctrlKey || e.altKey || focusIsTyping()) return true
  // Includes the photo viewer, which owns the arrow keys while it is open.
  return document.querySelector('[role="dialog"]') !== null
}

/** Two g presses closer than this are gg. */
export const GG_MS = 600

/** The keys whose keydown is a modifier alone. */
export const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"])

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
  // PROTOTYPE (D): a modifier's own keydown (the Shift of g then T) keeps a
  // pending g.
  if (MODIFIERS.has(key) && variantNow() !== "0") return { move: null, lastG }
  // PROTOTYPE (F): a pending g is shown (its pop-up), and waits for its key.
  const live = gLive(lastG, now, GG_MS)
  if (key !== "g" || live) setGPending(false)
  if (key === "j" || key === "k") return { move: key, lastG: 0 }
  if (key === "G") return { move: "last", lastG: 0 }
  if (key !== "g") return { move: null, lastG: 0 }
  if (live) return { move: "first", lastG: 0 }
  setGPending(true)
  return { move: null, lastG: now }
}
