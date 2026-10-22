/**
 * The Posts feed's adapter on keyboard mode's engine (PTR-02, ADR-034): its
 * cards in order, how to reach one, and its own keys: - and + for compact or
 * full cards, M for every Post's text, c to leave a spotlight. The engine
 * moves the Highlight and presses the card control carrying a key's
 * `data-shortcut`, so each action keeps one implementation, its button's.
 */
import { useKeyboardList } from "@/components/keyboard/useKeyboardList"
import { ACTIONS, LIST_KEYS } from "@/lib/keyboard/key-list"

/** A Post card's `data-post-key`, which is its id in the list. */
export const postCardKey = (post: { channelName: string; id: number }) =>
  `${post.channelName}_${post.id}`

const cardOf = (key: string) =>
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
}: {
  /** The cards' `data-post-key`s, in feed order. */
  keys: readonly string[]
  onCompact: (compact: boolean) => void
  /** A Channel spotlight is on. */
  spotlit: boolean
  /** c inside a spotlight: back where it was opened from. */
  onSpotlightBack: () => void
}): string | null {
  return useKeyboardList({
    list: "posts",
    items: keys,
    element: cardOf,
    reveal: (at) =>
      cardOf(keys[at])?.scrollIntoView({ block: "start", behavior: "smooth" }),
    name: (key) => `@${key.slice(0, key.lastIndexOf("_"))}`,
    // The first move lands on the first card on screen, not the feed's top.
    start: () =>
      Math.max(
        0,
        keys.findIndex(
          (key) =>
            (cardOf(key)?.getBoundingClientRect().bottom ?? 0) > HEADER_PX,
        ),
      ),
    key: (key) => {
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
  }).highlight
}
