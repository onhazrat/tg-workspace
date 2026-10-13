/**
 * Keyboard mode for the Directory (DFP-01), on the Posts feed's and Channels
 * grid's terms (`post-card/FeedKeyboard.tsx`,
 * `channel-grid/ChannelGridKeyboard.tsx`): j / k move a highlight through the
 * rows, gg / G jump, and a letter presses the control carrying
 * `data-shortcut="<letter>"` in the highlighted row, so each action keeps its
 * control's one implementation. ] and [ turn the page.
 *
 * Enter opens the panel on the highlighted row and closes it again; while it
 * is open it follows every move and page turn, a reading pane. Esc drops the
 * highlight and closes the panel. The highlight is a handle in state, which
 * the row renders as `data-kbd-selected`.
 */
import { useEffect, useRef, useState } from "react"
import { KeyHelp } from "@/components/KeyHelp"
import { keyBelongsElsewhere, nextIndex, readMove } from "@/lib/keyboard-moves"

/** The letter each row action answers to; its control carries it as `data-shortcut`. */
export const DIRECTORY_SHORTCUTS = {
  tick: "x",
  follow: "f",
  dismiss: "d",
  open: "o",
  tag: "t",
} as const

const rowOf = (handle: string) =>
  document.querySelector(`[data-directory-handle="${CSS.escape(handle)}"]`)

/** The highlighted row's handle, or null; keys are listened for while `on`. */
export function useDirectoryKeyboard({
  on,
  handles,
  open,
  onOpen,
  page,
  lastPage,
  onPage,
}: {
  on: boolean
  /** The rows on screen, in order. */
  handles: string[]
  /** The handle whose panel is open. */
  open: string | null
  onOpen: (handle: string | null) => void
  page: number
  lastPage: number
  onPage: (page: number) => void
}): string | null {
  const [ring, setRing] = useState<string | null>(null)
  // When an unanswered g was pressed; a ref, because the listener is re-bound.
  const lastG = useRef(0)
  // After a page turn, the rows it was turned from: the highlight lands on the
  // first row once different rows arrive.
  const turnedFrom = useRef<string | null>(null)
  const rowsKey = handles.join(" ")
  const landing = useRef({ handles, open, onOpen })
  landing.current = { handles, open, onOpen }

  useEffect(() => {
    if (turnedFrom.current === null || turnedFrom.current === rowsKey) return
    turnedFrom.current = null
    const { handles, open, onOpen } = landing.current
    if (!handles.length) return
    setRing(handles[0])
    if (open) onOpen(handles[0])
  }, [rowsKey])

  useEffect(() => {
    if (ring) rowOf(ring)?.scrollIntoView({ block: "nearest" })
  }, [ring])

  useEffect(() => {
    if (!on) {
      setRing(null)
      turnedFrom.current = null
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (keyBelongsElsewhere(e)) return
      if (e.key === "Escape") {
        setRing(null)
        onOpen(null)
        return
      }
      if (e.key === "]" || e.key === "[") {
        const next = page + (e.key === "]" ? 1 : -1)
        if (next < 0 || next > lastPage) return
        e.preventDefault()
        turnedFrom.current = rowsKey
        onPage(next)
        return
      }
      const read = readMove(e.key, Date.now(), lastG.current)
      lastG.current = read.lastG
      const { move } = read
      if (move || e.key === "g") {
        e.preventDefault()
        if (!move || !handles.length) return
        const at = ring ? handles.indexOf(ring) : -1
        const handle = handles[at < 0 ? 0 : nextIndex(at, move, handles.length)]
        setRing(handle)
        if (open) onOpen(handle)
        return
      }
      if (!ring) return
      if (e.key === "Enter") {
        e.preventDefault()
        onOpen(open ? null : ring)
        return
      }
      const target = rowOf(ring)?.querySelector<HTMLElement>(
        `[data-shortcut="${CSS.escape(e.key)}"]`,
      )
      if (!target) return
      e.preventDefault()
      target.click()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [on, ring, handles, rowsKey, open, onOpen, page, lastPage, onPage])

  return on ? ring : null
}

const KEY_HELP = [
  ["j / k", "next / previous channel"],
  ["gg / G", "first / last on the page"],
  ["] / [", "next / previous page"],
  ["enter", "open or close the panel"],
  [DIRECTORY_SHORTCUTS.tick, "tick or untick"],
  [DIRECTORY_SHORTCUTS.follow, "follow"],
  [DIRECTORY_SHORTCUTS.dismiss, "dismiss or take back"],
  [DIRECTORY_SHORTCUTS.open, "open in Telegram"],
  [DIRECTORY_SHORTCUTS.tag, "tag"],
  ["esc", "drop the highlight"],
] as const

/** The key legend while keyboard mode is on. */
export function DirectoryKeyHelp({ on }: { on: boolean }) {
  return on ? <KeyHelp rows={KEY_HELP} /> : null
}
