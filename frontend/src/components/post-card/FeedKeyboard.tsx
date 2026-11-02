/**
 * The Posts feed's adapter on keyboard mode's engine (PTR-02, ADR-034): its
 * cards in order, how to reach one, and its own keys: - and + for compact or
 * full cards, M for every Post's text, c to leave a spotlight, `.` to show
 * the held new Posts (RCH-01), and `[` to open a reply's Reply chain, which
 * is then the list until `]` or Esc closes it (RCH-02). The engine moves the
 * Highlight and presses the card control carrying a key's `data-shortcut`,
 * so each action keeps one implementation, its button's.
 */
import { useEffect } from "react"
import { toast } from "sonner"
import { useKeyboardList } from "@/components/keyboard/useKeyboardList"
import { ACTIONS, LIST_KEYS } from "@/lib/keyboard/key-list"

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

/** The Reply chain as the keys reach it (`ReplyChain`). */
export interface ChainKeys {
  /** The open chain's items, top to bottom; null while it is closed. */
  items: readonly string[] | null
  /** Where a first move in the open chain starts: the reply's parent. */
  ring: string | null
  /** Where the Highlight goes once the chain is read: the reply's parent. */
  start: string | null
  /** The open chain's item for a key, and bringing it into view. */
  element: (key: string) => HTMLElement | null
  reveal: (key: string) => void
  /** [ on a feed Post: opens its chain, or says it is not a reply. */
  open: (key: string) => void
  close: () => void
}

/** The highlighted card's or chain item's key, or null, and a way to set it. */
export function usePostKeys({
  keys,
  onCompact,
  spotlit,
  onSpotlightBack,
  onShowNew,
  chain,
}: {
  /** The cards' `data-post-key`s, in feed order. */
  keys: readonly string[]
  onCompact: (compact: boolean) => void
  /** A Channel spotlight is on. */
  spotlit: boolean
  /** c inside a spotlight: back where it was opened from. */
  onSpotlightBack: () => void
  /** .: shows the held new Posts; the first one's key, or null with none. */
  onShowNew: () => string | null
  chain?: ChainKeys
}): { highlight: string | null; setHighlight: (key: string | null) => void } {
  const panel = chain?.items ?? null
  const list = useKeyboardList({
    list: panel ? "chain" : "posts",
    items: panel ?? keys,
    element: panel && chain ? chain.element : cardOf,
    reveal: (at) =>
      panel
        ? chain?.reveal(panel[at])
        : cardOf(keys[at])?.scrollIntoView({
            block: "start",
            behavior: "smooth",
          }),
    name: (key) => `@${key.slice(0, key.lastIndexOf("_"))}`,
    // The first move lands on the first card on screen, not the feed's top;
    // in the chain, on the reply's parent.
    start: () =>
      panel
        ? Math.max(0, panel.indexOf(chain?.ring ?? ""))
        : Math.max(
            0,
            keys.findIndex(
              (key) =>
                (cardOf(key)?.getBoundingClientRect().bottom ?? 0) > HEADER_PX,
            ),
          ),
    onDrop: panel ? chain?.close : undefined,
    key: (key, highlight) => {
      if (chain && key === LIST_KEYS.earlier) {
        // While open, [ is taken and does nothing.
        if (panel) return true
        if (!highlight) return false
        chain.open(highlight)
        return true
      }
      if (panel && key === LIST_KEYS.later) {
        chain?.close()
        return true
      }
      if (key === LIST_KEYS.showNew) {
        const first = onShowNew()
        // The panel keeps the Highlight while it is open.
        if (first && !panel) list.setHighlight(first)
        else toast("No new posts", { id: "new-posts" })
        return true
      }
      if (key === LIST_KEYS.smaller || key === LIST_KEYS.larger) {
        onCompact(key === LIST_KEYS.smaller)
        return true
      }
      if (key === LIST_KEYS.everyText) {
        toggleEveryText()
        return true
      }
      // In a spotlight the card's own button is hidden; c is the way back.
      if (key !== ACTIONS.spotlight.key || !spotlit || panel) return false
      onSpotlightBack()
      return true
    },
    search: () =>
      document.querySelector(
        'input[aria-label="Keyword search"], input[aria-label="Meaning search"]',
      ),
  })
  // The Highlight starts on the parent once the chain's items are in.
  const start = panel?.length ? (chain?.start ?? null) : null
  const setHighlight = list.setHighlight
  useEffect(() => {
    if (start) setHighlight(start)
  }, [start])
  return list
}
