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
  controlKey,
  ensureSelected,
  goAfterG,
  type KeyTab,
  readExtend,
  tabKeys,
  useKeptRing,
} from "@/components/directory-photo-prototype/keys"
import { useVariant } from "@/components/directory-photo-prototype/variant"
import { KeyHelp } from "@/components/KeyHelp"
import { keyBelongsElsewhere, nextIndex, readMove } from "@/lib/keyboard-moves"

/** The letter each row action answers to; its control carries it as `data-shortcut`. */
export const DIRECTORY_SHORTCUTS = {
  tick: "x",
  follow: "f",
  dismiss: "d",
  open: "o",
  tag: "t",
  /** The avatar's own, as on the Channels tab's cards (`ChannelAvatar`). */
  photo: "p",
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
  tab = "directory",
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
  /** PROTOTYPE (D): Discover's keyboard is this one, on its own letters. */
  tab?: KeyTab
}): string | null {
  const [ring, setRing] = useState<string | null>(null)
  // When an unanswered g was pressed; a ref, because the listener is re-bound.
  const lastG = useRef(0)
  // PROTOTYPE (B): the highlight survives a tab switch.
  useKeptRing(tab, on, ring, setRing, handles)
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
      // PROTOTYPE (F): a count, or Esc cancelling one or a pending g.
      if (prefixKey(e, lastG)) return
      if (e.key === "Escape") {
        setRing(null)
        onOpen(null)
        return
      }
      // PROTOTYPE (F): F / D act on everything ticked, through the bulk bar.
      if (tab !== "history" && bulkKey(e.key)) {
        e.preventDefault()
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
      // PROTOTYPE (C): g p / g c / g d go to a tab.
      if (goAfterG(e.key, lastG.current)) {
        lastG.current = 0
        e.preventDefault()
        return
      }
      // PROTOTYPE (C): J / K move and tick.
      const { key, extend } = readExtend(e.key)
      const read = readMove(key, Date.now(), lastG.current)
      lastG.current = read.lastG
      const { move } = read
      if (move || e.key === "g") {
        e.preventDefault()
        if (!move || !handles.length) return
        // PROTOTYPE (F): 5j, 7k, 37G; J / K take no count.
        const n = extend ? (clearCount(), null) : takeCount()
        const at = ring ? handles.indexOf(ring) : -1
        const to =
          at < 0
            ? n && move !== "j" && move !== "k"
              ? stepIndex(0, move, handles.length, n)
              : n
                ? stepIndex(0, "j", handles.length, n - 1 || null)
                : 0
            : isF()
              ? stepIndex(at, move, handles.length, n)
              : nextIndex(at, move, handles.length)
        const handle = handles[to]
        if (extend) {
          if (ring) ensureSelected(rowOf(ring))
          ensureSelected(rowOf(handle))
          extendToast(rowOf(handle))
        }
        announce(rowOf(handle), to, handles.length)
        setRing(handle)
        if (open) onOpen(handle)
        return
      }
      clearCount()
      if (!ring) return
      if (e.key === "Enter") {
        e.preventDefault()
        onOpen(open ? null : ring)
        return
      }
      // PROTOTYPE (B): the key list's letter, to the control's.
      const letter = controlKey(tab, e.key)
      if (!letter) return
      const row = rowOf(ring)
      const target = row?.querySelector<HTMLElement>(
        `[data-shortcut="${CSS.escape(letter)}"]`,
      )
      if (!(row instanceof HTMLElement) || !target) return
      e.preventDefault()
      pressControl(e.key, row, target)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [on, ring, handles, rowsKey, open, onOpen, page, lastPage, onPage, tab])

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
  [DIRECTORY_SHORTCUTS.photo, "view photo"],
  ["esc", "drop the highlight"],
] as const

/** The key legend while keyboard mode is on. */
export function DirectoryKeyHelp({
  on,
  tab = "directory",
}: {
  on: boolean
  /** PROTOTYPE (D): Discover's legend too. */
  tab?: KeyTab
}) {
  // PROTOTYPE: the key list's, past 0.
  const variant = useVariant()
  if (variant !== "0") return on ? <KeyHelp rows={tabKeys(tab)} /> : null
  const rows =
    variant !== "0"
      ? KEY_HELP
      : KEY_HELP.filter(([key]) => key !== DIRECTORY_SHORTCUTS.photo)
  return on ? <KeyHelp rows={rows} /> : null
}
