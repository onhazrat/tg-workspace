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
import {
  announce,
  bulkKey,
  clearCount,
  extendToast,
  isF,
  prefixKey,
  pressControl,
  stepIndex,
  takeCount,
} from "@/components/directory-photo-prototype/fkeys"
import {
  carried,
  controlKey,
  ensureSelected,
  goAfterG,
  openSpotlightFromChannels,
  readExtend,
  tabKeys,
  useKeptRing,
} from "@/components/directory-photo-prototype/keys"
import {
  since,
  useVariant,
  variantNow,
} from "@/components/directory-photo-prototype/variant"
import { KeyHelp } from "@/components/KeyHelp"
import {
  CARD_ZOOM_LEVELS,
  type CardKey,
  type CardZoom,
} from "@/lib/channels/card-zoom"
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
  // PROTOTYPE (B): the highlight survives a tab switch.
  useKeptRing("channels", on, ring, setRing, names, (at) =>
    scrollToRow(Math.floor(at / lanes)),
  )

  useEffect(() => {
    if (!on) {
      setRing(null)
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (keyBelongsElsewhere(e)) return
      // PROTOTYPE (F): a count, or Esc cancelling one or a pending g.
      if (prefixKey(e, lastG)) return
      if (e.key === "Escape") {
        setRing(null)
        return
      }
      // PROTOTYPE (C): g p / g c / g d go to a tab.
      if (goAfterG(e.key, lastG.current)) {
        lastG.current = 0
        e.preventDefault()
        return
      }
      // PROTOTYPE (C): J / K move and select.
      const { key, extend } = readExtend(e.key)
      const read = readMove(key, Date.now(), lastG.current)
      lastG.current = read.lastG
      const { move } = read
      if (move || e.key === "g") {
        e.preventDefault()
        if (!move || names.length === 0) return
        // PROTOTYPE (F): 5j, 7k, 37G; J / K take no count.
        const n = extend ? (clearCount(), null) : takeCount()
        const at = ring ? names.indexOf(ring) : -1
        const start =
          at < 0 && (move === "j" || move === "k")
            ? // Start from the first row on screen, not the top of the grid.
              Math.min(firstVisibleRow * lanes, names.length - 1)
            : -1
        const next =
          start >= 0
            ? n
              ? stepIndex(start, move, names.length, n - 1 || null)
              : start
            : isF()
              ? stepIndex(at, move, names.length, n)
              : nextIndex(at, move, names.length)
        const card = (name: string | null | undefined) =>
          name
            ? document.querySelector(
                `[data-channel-name="${CSS.escape(name)}"]`,
              )
            : null
        if (extend) ensureSelected(card(ring))
        setRing(names[next])
        scrollToRow(Math.floor(next / lanes))
        // The grid is virtualised: the card may mount after the scroll.
        window.setTimeout(() => {
          if (extend) {
            ensureSelected(card(names[next]))
            extendToast(card(names[next]))
          }
          announce(card(names[next]), next, names.length)
        }, 80)
        return
      }
      clearCount()
      if (!ring) return
      // PROTOTYPE (C): c opens the Channel's posts in Posts.
      if (since(variantNow(), "C") && e.key === "c") {
        e.preventDefault()
        openSpotlightFromChannels(ring)
        return
      }
      // PROTOTYPE (B): the key list's letter, to the control's.
      const letter = controlKey("channels", e.key)
      if (!letter) return
      const item = document.querySelector<HTMLElement>(
        `[data-channel-name="${CSS.escape(ring)}"]`,
      )
      const target = item?.querySelector<HTMLElement>(
        `[data-shortcut="${CSS.escape(letter)}"]`,
      )
      if (!item || !target) return
      e.preventDefault()
      pressControl(e.key, item, target)
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

/**
 * PROTOTYPE (variant A): - and + make the cards smaller and larger in keyboard
 * mode, a step of the size switch each, stopping at either end. = counts as
 * +, so no Shift is needed.
 */
export function useCardZoomKeys({
  on,
  zoom,
  onZoomChange,
}: {
  on: boolean
  zoom: CardZoom
  onZoomChange: (zoom: CardZoom) => void
}) {
  const variant = useVariant()
  useEffect(() => {
    if (!on || variant === "0") return
    const onKey = (e: KeyboardEvent) => {
      if (keyBelongsElsewhere(e)) return
      const by = e.key === "-" ? -1 : e.key === "+" || e.key === "=" ? 1 : 0
      if (!by) return
      e.preventDefault()
      const at = CARD_ZOOM_LEVELS.indexOf(zoom)
      const next = CARD_ZOOM_LEVELS[at + by]
      if (next !== undefined) onZoomChange(next)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [on, variant, zoom, onZoomChange])
}

/** The legend: the moves, then only the letters this card size carries. */
export function ChannelKeyHelp({
  on,
  keys,
}: {
  on: boolean
  keys: readonly CardKey[]
}) {
  // PROTOTYPE: the size keys in A.
  const variant = useVariant()
  carried.channels = keys
  if (!on) return null
  if (variant !== "0") return <KeyHelp rows={tabKeys("channels", keys)} />
  return (
    <KeyHelp
      rows={[
        ["j / k", "next / previous channel"],
        ["gg / G", "first / last channel"],
        ...(variant !== "0"
          ? ([["- / +", "smaller / larger cards"]] as const)
          : []),
        ...keys.map((key) => [key, KEY_LABEL[key]] as const),
        ["esc", "drop the highlight"],
      ]}
    />
  )
}
