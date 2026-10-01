/**
 * Keyboard mode for the Posts feed (PTR-02). j and k move a ring through the
 * cards; a letter clicks the element carrying `data-shortcut="<letter>"`
 * inside the ringed card, so each action keeps one implementation, its
 * button's. The ring is a `data-kbd-selected` attribute on the card.
 */
import { useEffect } from "react"

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
  [SHORTCUTS.photo, "open photo"],
  [SHORTCUTS.channel, "this channel alone"],
  [SHORTCUTS.translate, "translate"],
  [SHORTCUTS.related, "find related"],
  [SHORTCUTS.copy, "copy link"],
  [SHORTCUTS.open, "open in Telegram"],
  [SHORTCUTS.select, "select or deselect"],
] as const

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
function keyBelongsElsewhere(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || focusIsTyping()) return true
  // Includes the photo viewer, which owns the arrow keys while it is open.
  return document.querySelector('[role="dialog"]') !== null
}

export function FeedKeyboard({ on }: { on: boolean }) {
  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent) => {
      if (keyBelongsElsewhere(e)) return
      const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD))
      const at = cards.findIndex((c) => c.hasAttribute(RING))
      if (e.key === "j" || e.key === "k") {
        e.preventDefault()
        const next =
          at < 0
            ? // Start from the first card on screen, not the top of the feed.
              Math.max(
                0,
                cards.findIndex(
                  (c) => c.getBoundingClientRect().bottom > HEADER_PX,
                ),
              )
            : Math.max(
                0,
                Math.min(cards.length - 1, at + (e.key === "j" ? 1 : -1)),
              )
        const card = cards[next]
        if (!card) return
        cards[at]?.removeAttribute(RING)
        card.setAttribute(RING, "")
        card.scrollIntoView({ block: "start", behavior: "smooth" })
        return
      }
      const target = cards[at]?.querySelector<HTMLElement>(
        `[data-shortcut="${CSS.escape(e.key)}"]`,
      )
      if (target) {
        e.preventDefault()
        target.click()
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
  return (
    <div className="fixed bottom-4 left-4 z-50 hidden rounded-xl border border-app-ink/10 bg-app-card/95 p-3 text-[11px] shadow-lg backdrop-blur md:block">
      {KEY_HELP.map(([key, what]) => (
        <div key={key} className="flex gap-3">
          <kbd className="w-10 font-mono text-app-ink">{key}</kbd>
          <span className="text-app-ink/60">{what}</span>
        </div>
      ))}
    </div>
  )
}
