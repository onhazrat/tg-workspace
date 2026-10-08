/**
 * Keyboard mode for the Channels grid (CARD-05), on the Posts feed's terms
 * (`post-card/FeedKeyboard.tsx`): a highlight moves through the cards and a
 * letter presses the control carrying `data-shortcut="<letter>"` in the
 * highlighted card, so each action keeps one implementation, its control's.
 *
 * Unlike the feed, the grid is virtualised: a card scrolled out of range is
 * unmounted, and an attribute set on it would be lost. So the highlight is a
 * Channel name in state, which the card renders as `data-kbd-selected`, and
 * moving it scrolls the virtualiser rather than the element.
 */
import { useEffect, useRef, useState } from "react"
import { KeyHelp } from "@/components/KeyHelp"
import type { CardKey } from "@/lib/channels/card-zoom"
import { keyBelongsElsewhere, nextIndex, readMove } from "@/lib/keyboard-moves"
import { REVEAL_CHANNEL } from "../post-card/PhotoViewer"

const KEY_LABEL: Record<CardKey, string> = {
  x: "select or deselect",
  s: "sync",
  t: "add a tag",
  f: "freeze or unfreeze",
  o: "open in Telegram",
  b: "more or less bio",
  p: "view photo",
}

/** The highlighted Channel's name, or null; keys are listened for while `on`. */
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
  /** Scrolls the grid so this row is in the middle of the screen. */
  scrollToRow: (row: number) => void
}): string | null {
  const [ring, setRing] = useState<string | null>(null)
  // When an unanswered g was pressed; a ref, because the listener is re-bound.
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
      const read = readMove(e.key, Date.now(), lastG.current)
      lastG.current = read.lastG
      const { move } = read
      if (move || e.key === "g") {
        e.preventDefault()
        if (!move || names.length === 0) return
        const at = ring ? names.indexOf(ring) : -1
        const next =
          at < 0 && (move === "j" || move === "k")
            ? // Start from the first row on screen, not the top of the grid.
              Math.min(firstVisibleRow * lanes, names.length - 1)
            : nextIndex(at, move, names.length)
        setRing(names[next])
        scrollToRow(Math.floor(next / lanes))
        return
      }
      if (!ring) return
      const target = document
        .querySelector(`[data-channel-name="${CSS.escape(ring)}"]`)
        ?.querySelector<HTMLElement>(`[data-shortcut="${CSS.escape(e.key)}"]`)
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

/**
 * Scrolls to the Channel the photo viewer was left on when it closes, for a
 * card the grid unmounted while the viewer was open.
 */
export function useRevealChannel({
  names,
  lanes,
  scrollToRow,
}: {
  names: string[]
  lanes: number
  scrollToRow: (row: number) => void
}) {
  useEffect(() => {
    const onReveal = (e: Event) => {
      const at = names.indexOf((e as CustomEvent<string>).detail)
      if (at >= 0) scrollToRow(Math.floor(at / lanes))
    }
    window.addEventListener(REVEAL_CHANNEL, onReveal)
    return () => window.removeEventListener(REVEAL_CHANNEL, onReveal)
  }, [names, lanes, scrollToRow])
}

/** The legend: the moves, then only the letters this card size carries. */
export function ChannelKeyHelp({
  on,
  keys,
}: {
  on: boolean
  keys: readonly CardKey[]
}) {
  if (!on) return null
  return (
    <KeyHelp
      rows={[
        ["j / k", "next / previous channel"],
        ["gg / G", "first / last channel"],
        ...keys.map((key) => [key, KEY_LABEL[key]] as const),
        ["esc", "drop the highlight"],
      ]}
    />
  )
}
