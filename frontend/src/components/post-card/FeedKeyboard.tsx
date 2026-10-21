/**
 * Keyboard mode for the Posts feed (PTR-02). j and k move a ring through the
 * cards, G jumps to the last and gg to the first; a letter clicks the element carrying `data-shortcut="<letter>"`
 * inside the ringed card, so each action keeps one implementation, its
 * button's. The ring is a `data-kbd-selected` attribute on the card.
 */
import { useEffect, useRef } from "react"
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
  backToChannels,
  controlKey,
  ensureSelected,
  goAfterG,
  lastRing,
  readExtend,
  tabKeys,
} from "@/components/directory-photo-prototype/keys"
import {
  useVariant,
  variantNow,
} from "@/components/directory-photo-prototype/variant"
import { KeyHelp } from "@/components/KeyHelp"
import { keyBelongsElsewhere, nextIndex, readMove } from "@/lib/keyboard-moves"

const CARD = "article[data-post-key]"
const RING = "data-kbd-selected"
/** A card hidden under the workspace's sticky header is not "on screen". */
const HEADER_PX = 80

/** The letter each card action answers to; the buttons carry it as `data-shortcut`. */
export const SHORTCUTS = {
  photo: "p",
  channel: "f",
  translate: "t",
  related: "r",
  copy: "c",
  open: "o",
  select: "x",
} as const

const KEY_HELP = [
  ["j / k", "next / previous post"],
  ["gg / G", "first / last post"],
  [SHORTCUTS.photo, "open photo"],
  [SHORTCUTS.channel, "this channel alone"],
  [SHORTCUTS.translate, "translate"],
  [SHORTCUTS.related, "find related"],
  [SHORTCUTS.copy, "copy link"],
  [SHORTCUTS.open, "open in Telegram"],
  [SHORTCUTS.select, "select or deselect"],
] as const

export function FeedKeyboard({
  on,
  onCompact,
}: {
  on: boolean
  /** PROTOTYPE (B): - and + make the grid compact or full. */
  onCompact?: (compact: boolean) => void
}) {
  // When an unanswered g was pressed, so a second one makes gg.
  const lastG = useRef(0)
  const variant = useVariant()
  // A ref: the setter is new each render, and re-binding the listener would
  // clear the ring (the effect's cleanup).
  const compactRef = useRef(onCompact)
  compactRef.current = onCompact
  // PROTOTYPE (B): the highlight survives a tab switch, once its card renders.
  useEffect(() => {
    if (!on || variantNow() === "0") return
    const key = lastRing.posts
    if (!key) return
    const timers = [0, 300, 1000, 2500].map((ms) =>
      window.setTimeout(() => {
        if (document.querySelector(`${CARD}[${RING}]`)) return
        const card = document.querySelector<HTMLElement>(
          `${CARD}[data-post-key="${CSS.escape(key)}"]`,
        )
        if (!card) return
        card.setAttribute(RING, "")
        card.scrollIntoView({ block: "start" })
      }, ms),
    )
    return () => timers.forEach(window.clearTimeout)
  }, [on])
  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent) => {
      if (keyBelongsElsewhere(e)) return
      // PROTOTYPE (F): a count, or Esc cancelling one or a pending g.
      if (prefixKey(e, lastG)) return
      // PROTOTYPE (F): Esc drops the highlight, as in the other tabs; a
      // second Esc is the spotlight's again.
      const ringed = document.querySelector(`${CARD}[${RING}]`)
      if (isF() && e.key === "Escape" && ringed) {
        e.preventDefault()
        ringed.removeAttribute(RING)
        lastRing.posts = undefined
        return
      }
      // PROTOTYPE (F): M opens every post's text, or closes them all when
      // none is left to open.
      if (isF() && e.key === "M") {
        e.preventDefault()
        const buttons = Array.from(
          document.querySelectorAll<HTMLElement>(`${CARD} [data-shortcut="m"]`),
        )
        const closed = buttons.filter(
          (b) => b.getAttribute("aria-expanded") === "false",
        )
        for (const b of closed.length ? closed : buttons) b.click()
        return
      }
      const onCompact = compactRef.current
      if (variantNow() !== "0" && onCompact) {
        if (e.key === "-") onCompact(true)
        if (e.key === "+" || e.key === "=") onCompact(false)
        if (e.key === "-" || e.key === "+" || e.key === "=") {
          e.preventDefault()
          return
        }
      }
      // PROTOTYPE (C): g p / g c / g d go to a tab.
      if (goAfterG(e.key, lastG.current)) {
        lastG.current = 0
        e.preventDefault()
        return
      }
      // PROTOTYPE (C): J / K move and select.
      const { key, extend } = readExtend(e.key)
      const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD))
      const at = cards.findIndex((c) => c.hasAttribute(RING))
      const read = readMove(key, Date.now(), lastG.current)
      lastG.current = read.lastG
      const { move } = read
      if (move || e.key === "g") {
        e.preventDefault()
        if (!move) return
        // PROTOTYPE (F): 5j, 7k, 37G; J / K take no count.
        const n = extend ? (clearCount(), null) : takeCount()
        const from =
          at < 0 && (move === "j" || move === "k")
            ? // Start from the first card on screen, not the top of the feed.
              Math.max(
                0,
                cards.findIndex(
                  (c) => c.getBoundingClientRect().bottom > HEADER_PX,
                ),
              )
            : -1
        const next =
          from >= 0
            ? n
              ? stepIndex(from, move, cards.length, n - 1 || null)
              : from
            : isF()
              ? stepIndex(at, move, cards.length, n)
              : nextIndex(at, move, cards.length)
        const card = cards[next]
        if (!card) return
        if (extend) {
          ensureSelected(cards[at])
          ensureSelected(card)
          extendToast(card)
        }
        cards[at]?.removeAttribute(RING)
        card.setAttribute(RING, "")
        announce(card, next, cards.length)
        if (card.dataset.postKey) lastRing.posts = card.dataset.postKey
        card.scrollIntoView({ block: "start", behavior: "smooth" })
        return
      }
      clearCount()
      // PROTOTYPE (B): c toggles: in a spotlight it goes back to the feed,
      // where the card's own button is hidden.
      const back = document.querySelector<HTMLElement>(
        '[data-testid="channel-spotlight"] > button',
      )
      if (variantNow() !== "0" && e.key === "c" && back) {
        e.preventDefault()
        // PROTOTYPE (C): a spotlight Channels opened goes back there.
        if (!backToChannels()) back.click()
        return
      }
      // PROTOTYPE (B): the key list's letter, to the control's.
      const letter = controlKey("posts", e.key)
      if (!letter) return
      const target = cards[at]?.querySelector<HTMLElement>(
        `[data-shortcut="${CSS.escape(letter)}"]`,
      )
      if (target && cards[at]) {
        e.preventDefault()
        pressControl(e.key, cards[at], target)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      for (const card of document.querySelectorAll(`[${RING}]`))
        card.removeAttribute(RING)
    }
  }, [on])

  if (!on) return null
  return <KeyHelp rows={variant !== "0" ? tabKeys("posts") : KEY_HELP} />
}
