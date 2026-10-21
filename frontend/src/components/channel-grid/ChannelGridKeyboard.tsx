/**
 * The Channels grid's adapter on keyboard mode's engine (CARD-05, ADR-034):
 * its Channels in order, how to scroll to one, and its own keys: - and + for
 * the card sizes, c for the Highlight's Channel alone in Posts. The engine
 * moves the Highlight and presses the card control carrying a key's
 * `data-shortcut`.
 *
 * The grid is virtualised: a card scrolled out of range is unmounted, so the
 * Highlight is a Channel name the card renders as `data-kbd-selected`, and
 * moving it scrolls the virtualiser rather than the element.
 */
import { useEffect } from "react"
import { useKeyboardList } from "@/components/keyboard/useKeyboardList"
import {
  CARD_ZOOM_LEVELS,
  type CardKey,
  type CardZoom,
} from "@/lib/channels/card-zoom"
import { REVEAL_CHANNEL } from "../post-card/PhotoViewer"

const cardOf = (name: string) =>
  document.querySelector<HTMLElement>(
    `[data-channel-name="${CSS.escape(name)}"]`,
  )

/** The highlighted Channel's name, or null. */
export function useChannelKeys({
  names,
  lanes,
  firstVisibleRow,
  scrollToRow,
  zoom,
  onZoomChange,
  onSpotlight,
  carried,
}: {
  /** The grid's Channels, in order. */
  names: string[]
  lanes: number
  firstVisibleRow: number
  /** Scrolls the grid so this row is in the middle of the screen. */
  scrollToRow: (row: number) => void
  zoom: CardZoom
  onZoomChange: (zoom: CardZoom) => void
  /** Shows this Channel alone in Posts. */
  onSpotlight: (name: string) => void
  /** The actions this card size carries a control for. */
  carried?: readonly CardKey[]
}): string | null {
  return useKeyboardList({
    list: "channels",
    carried: carried && [...carried, "spotlight"],
    items: names,
    element: cardOf,
    reveal: (at) => scrollToRow(Math.floor(at / lanes)),
    name: (name) => `@${name}`,
    // The first move lands on the first row on screen, not the grid's top.
    start: () => Math.min(firstVisibleRow * lanes, names.length - 1),
    key: (key, highlight) => {
      if (key === "-" || key === "+") {
        const at = CARD_ZOOM_LEVELS.indexOf(zoom) + (key === "+" ? 1 : -1)
        const next = CARD_ZOOM_LEVELS[at]
        if (next !== undefined) onZoomChange(next)
        return true
      }
      if (key !== "c" || !highlight) return false
      onSpotlight(highlight)
      return true
    },
    search: () =>
      document.querySelector('input[placeholder="Search channels..."]'),
  }).highlight
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
