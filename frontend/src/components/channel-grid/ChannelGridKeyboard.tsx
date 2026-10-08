/**
 * Keyboard mode for the Channels grid, on the Posts feed's terms
 * (`post-card/FeedKeyboard.tsx`): a ring moves through the cards and a letter
 * clicks the element carrying `data-shortcut="<letter>"` in the ringed card,
 * so each action keeps one implementation, its button's.
 *
 * Unlike the feed, the grid is virtualised: a card scrolled out of range is
 * unmounted, and an attribute set on it would be lost. So the ring is state
 * here, a Channel name the card renders as `data-kbd-selected`, and moving it
 * scrolls the virtualiser rather than the element.
 */
import { useEffect, useRef, useState } from "react"
import { type GridMove, nextRingIndex } from "@/lib/channels/grid-keyboard"
import { KeyHelp, keyBelongsElsewhere } from "../post-card/FeedKeyboard"

/** The letter each card action answers to; the controls carry it as `data-shortcut`. */
export const CHANNEL_SHORTCUTS = {
  select: "x",
  sync: "s",
  tag: "t",
  freeze: "f",
  open: "o",
  bio: "b",
  photo: "p",
} as const

const KEY_HELP = [
  ["j / k", "next / previous channel"],
  ["gg / G", "first / last channel"],
  [CHANNEL_SHORTCUTS.select, "select or deselect"],
  [CHANNEL_SHORTCUTS.sync, "sync"],
  [CHANNEL_SHORTCUTS.tag, "add a tag"],
  [CHANNEL_SHORTCUTS.freeze, "freeze or unfreeze"],
  [CHANNEL_SHORTCUTS.open, "open in Telegram"],
  [CHANNEL_SHORTCUTS.bio, "more or less bio"],
  [CHANNEL_SHORTCUTS.photo, "view photo"],
  ["esc", "drop the ring"],
] as const

/** The ringed card's outline, kept off the frame so the frame's own flags stay separate. */
export const KBD_RING =
  "data-[kbd-selected]:ring-2 data-[kbd-selected]:ring-blue-500 data-[kbd-selected]:border-transparent"

/** Two g presses closer than this are gg. */
const GG_MS = 600

/** The ringed Channel's name, or null; keys are listened for while `on`. */
export function useChannelGridKeyboard({
  on,
  names,
  lanes,
  firstVisibleRow,
  scrollToRow,
}: {
  on: boolean
  /** The grid's Channels, in order. */
  names: string[]
  lanes: number
  firstVisibleRow: number
  scrollToRow: (row: number) => void
}): string | null {
  const [ring, setRing] = useState<string | null>(null)
  // A ref, because the listener is re-bound on every render.
  const lastG = useRef(0)

  useEffect(() => {
    if (!on) {
      setRing(null)
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (keyBelongsElsewhere(e)) return
      if (e.key === "Escape") {
        setRing(null)
        return
      }
      let move: GridMove | null = null
      if (e.key === "j" || e.key === "k") move = e.key
      else if (e.key === "G") move = "last"
      else if (e.key === "g") {
        const now = Date.now()
        if (now - lastG.current < GG_MS) {
          lastG.current = 0
          move = "first"
        } else {
          lastG.current = now
          return
        }
      }
      if (move) {
        e.preventDefault()
        if (names.length === 0) return
        const at = ring ? names.indexOf(ring) : -1
        const next =
          at < 0 && (move === "j" || move === "k")
            ? // Start from the first row on screen, not the top of the grid.
              Math.min(firstVisibleRow * lanes, names.length - 1)
            : nextRingIndex(at, move, names.length)
        setRing(names[next])
        scrollToRow(Math.floor(next / lanes))
        return
      }
      if (!ring) return
      const card = document.querySelector<HTMLElement>(
        `[data-channel-name="${CSS.escape(ring)}"]`,
      )
      const shortcut = `[data-shortcut="${CSS.escape(e.key)}"]`
      // A tile is its own selection control.
      const target = card?.matches(shortcut)
        ? card
        : card?.querySelector<HTMLElement>(shortcut)
      if (!target) return
      e.preventDefault()
      if (target instanceof HTMLInputElement) target.focus()
      else target.click()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [on, ring, names, lanes, firstVisibleRow, scrollToRow])

  return on ? ring : null
}

export function ChannelKeyHelp({ on }: { on: boolean }) {
  return on ? <KeyHelp rows={KEY_HELP} /> : null
}
