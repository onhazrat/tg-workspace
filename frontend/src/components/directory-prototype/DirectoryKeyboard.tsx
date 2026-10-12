/**
 * PROTOTYPE (directory-follow-picks): keyboard mode for the Directory list,
 * on the Posts feed's and Channels grid's terms (`post-card/FeedKeyboard.tsx`,
 * `channel-grid/ChannelGridKeyboard.tsx`). j / k move a highlight through the
 * rows, gg / G jump, a letter presses the control carrying
 * `data-shortcut="<letter>"` in the highlighted row, so each action keeps its
 * control's one implementation. ] and [ turn the page.
 *
 * Enter opens or closes the panel ("follow"); while it is open it follows the
 * highlight, a reading pane. Without "follow", Enter only opens it.
 */
import { useEffect, useRef, useState } from "react"
import { KeyHelp } from "@/components/KeyHelp"
import { keyBelongsElsewhere, nextIndex, readMove } from "@/lib/keyboard-moves"

export const DIRECTORY_SHORTCUTS = {
  tick: "x",
  follow: "f",
  dismiss: "d",
  open: "o",
} as const

export function useDirectoryKeyboard({
  on,
  handles,
  follow,
  open,
  onOpen,
  page,
  lastPage,
  onPage,
}: {
  on: boolean
  /** This page's rows, in order. */
  handles: string[]
  /** Enter toggles the panel, which follows the highlight while open (B). */
  follow: boolean
  /** The handle whose panel is open. */
  open: string | null
  onOpen: (handle: string | null) => void
  page: number
  lastPage: number
  onPage: (page: number) => void
}): string | null {
  const [ring, setRing] = useState<string | null>(null)
  const lastG = useRef(0)
  // A page turn lands the highlight on the first row once new rows arrive:
  // the rows it was turned from, until then.
  const turnedFrom = useRef<string | null>(null)
  const rowsKey = handles.join(" ")

  useEffect(() => {
    if (turnedFrom.current === null || turnedFrom.current === rowsKey) return
    turnedFrom.current = null
    if (!handles.length) return
    setRing(handles[0])
    if (follow && open) onOpen(handles[0])
  }, [rowsKey])

  useEffect(() => {
    if (!ring) return
    document
      .querySelector(`[data-directory-handle="${CSS.escape(ring)}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [ring])

  useEffect(() => {
    if (!on) {
      setRing(null)
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
        if (follow && open) onOpen(handle)
        return
      }
      if (!ring) return
      if (e.key === "Enter") {
        e.preventDefault()
        onOpen(follow && open ? null : ring)
        return
      }
      const target = document
        .querySelector(`[data-directory-handle="${CSS.escape(ring)}"]`)
        ?.querySelector<HTMLElement>(`[data-shortcut="${CSS.escape(e.key)}"]`)
      if (!target) return
      e.preventDefault()
      target.click()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [on, ring, handles, rowsKey, follow, open, onOpen, page, lastPage, onPage])

  return on ? ring : null
}

export function DirectoryKeyHelp({
  on,
  follow,
}: {
  on: boolean
  follow: boolean
}) {
  if (!on) return null
  return (
    <KeyHelp
      rows={[
        ["j / k", "next / previous channel"],
        ["gg / G", "first / last on the page"],
        ["] / [", "next / previous page"],
        ["enter", follow ? "open or close the panel" : "open the panel"],
        [DIRECTORY_SHORTCUTS.tick, "tick or untick"],
        [DIRECTORY_SHORTCUTS.follow, "follow"],
        [DIRECTORY_SHORTCUTS.dismiss, "dismiss or take back"],
        [DIRECTORY_SHORTCUTS.open, "open in Telegram"],
        ["esc", "drop the highlight"],
      ]}
    />
  )
}
