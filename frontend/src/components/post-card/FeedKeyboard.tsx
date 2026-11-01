/**
 * The Posts feed's adapter on keyboard mode's engine (PTR-02, ADR-034): its
 * cards in order, how to reach one, and its own keys: - and + for compact or
 * full cards, M for every Post's text, c to leave a spotlight. The engine
 * moves the Highlight and presses the card control carrying a key's
 * `data-shortcut`, so each action keeps one implementation, its button's.
 * [ and ] climb a reply chain and come back (`ReplyChain`).
 */

import { toast } from "sonner"
import { useKeyboardList } from "@/components/keyboard/useKeyboardList"
import { ACTIONS, LIST_KEYS, type Row } from "@/lib/keyboard/key-list"
import type { ReplyChain } from "./ReplyChain"

/** A Post card's `data-post-key`, which is its id in the list. */
export const postCardKey = (post: { channelName: string; id: number }) =>
  `${post.channelName}_${post.id}`

export const cardOf = (key: string) =>
  document.querySelector<HTMLElement>(
    `article[data-post-key="${CSS.escape(key)}"]`,
  )
/** A card hidden under the workspace's sticky header is not "on screen". */
const HEADER_PX = 80

/** M: opens every Post's text, or closes them all when none is left to open. */
function toggleEveryText() {
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>(
      `article[data-post-key] [data-shortcut="${ACTIONS.more.key}"]`,
    ),
  )
  const closed = buttons.filter(
    (b) => b.getAttribute("aria-expanded") === "false",
  )
  for (const b of closed.length ? closed : buttons) b.click()
}

/** The highlighted card's `data-post-key`, or null. */
export function usePostKeys({
  keys,
  onCompact,
  spotlit,
  onSpotlightBack,
  chain,
  onShowNew,
  target,
  panel,
  extraRows,
}: {
  /** The cards' `data-post-key`s, in feed order. */
  keys: readonly string[]
  onCompact: (compact: boolean) => void
  /** A Channel spotlight is on. */
  spotlit: boolean
  /** c inside a spotlight: back where it was opened from. */
  onSpotlightBack: () => void
  /** [ and ]: the reply chain; a move or Esc leaves it. */
  chain?: Pick<ReplyChain, "key" | "clear">
  /**
   * PROTOTYPE (posts-reply-chain): . shows the held new Posts; the first one
   * it shows takes the Highlight.
   */
  onShowNew?: () => string | null
  /**
   * PROTOTYPE (posts-reply-chain): the card the Highlight is on outside the
   * feed (the reply chain panel's), whose controls the keys press instead.
   */
  target?: () => HTMLElement | null
  /**
   * PROTOTYPE (posts-reply-chain), A3: while the chain panel is open, the
   * list keyboard mode moves through is the panel's, with its own Highlight.
   */
  panel?: {
    items: readonly string[]
    element: (key: string) => HTMLElement | null
    reveal: (el: HTMLElement | null) => void
  }
  /** PROTOTYPE (posts-reply-chain): the variant's own keys for the corner. */
  extraRows?: readonly Row[]
}): string | null {
  const list = useKeyboardList({
    list: panel ? "chain" : "posts",
    extraRows: panel ? undefined : extraRows,
    items: panel?.items ?? keys,
    element: panel?.element ?? cardOf,
    reveal: (at) =>
      panel
        ? panel.reveal(panel.element(panel.items[at]))
        : cardOf(keys[at])?.scrollIntoView({
            block: "start",
            behavior: "smooth",
          }),
    name: (key) => `@${key.slice(0, key.lastIndexOf("_"))}`,
    // The first move lands on the first card on screen, not the feed's top.
    start: () =>
      panel
        ? Math.max(0, panel.items.length - 2)
        : Math.max(
            0,
            keys.findIndex(
              (key) =>
                (cardOf(key)?.getBoundingClientRect().bottom ?? 0) > HEADER_PX,
            ),
          ),
    // A move inside the panel stays in it.
    onMove: panel ? undefined : chain?.clear,
    onDrop: chain?.clear,
    key: (key, highlight) => {
      if (chain?.key(key, highlight, list.setHighlight)) return true
      if (key === LIST_KEYS.showNew && onShowNew) {
        const first = onShowNew()
        if (first) list.setHighlight(first)
        else toast("No new posts", { id: "new-posts" })
        return true
      }
      const card = target?.()
      const control = card?.querySelector<HTMLElement>(
        `[data-shortcut="${CSS.escape(key)}"]`,
      )
      if (control) {
        control.click()
        return true
      }
      // An action the panel's card lacks never falls through to the feed's.
      if (card && Object.values(ACTIONS).some((a) => a.key === key)) return true
      if (key === LIST_KEYS.smaller || key === LIST_KEYS.larger) {
        onCompact(key === LIST_KEYS.smaller)
        return true
      }
      if (key === LIST_KEYS.everyText) {
        toggleEveryText()
        return true
      }
      // In a spotlight the card's own button is hidden; c is the way back.
      if (key !== ACTIONS.spotlight.key || !spotlit) return false
      onSpotlightBack()
      return true
    },
    search: () =>
      document.querySelector(
        'input[aria-label="Keyword search"], input[aria-label="Meaning search"]',
      ),
  })
  return list.highlight
}
