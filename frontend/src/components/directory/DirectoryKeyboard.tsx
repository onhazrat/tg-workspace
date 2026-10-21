/**
 * The Directory's adapter on keyboard mode's engine (DFP-01, ADR-034): its
 * rows, in order, and what Enter, Esc, ] and [ do to them. The engine moves
 * the Highlight and presses the row control carrying a key's
 * `data-shortcut`; the Directory handles no keys itself.
 *
 * Enter opens the panel on the Highlight and closes it again; while it is
 * open it follows every move and page turn, a reading pane. Esc drops the
 * Highlight and closes the panel.
 */
import { useEffect, useRef } from "react"
import { useKeyboardList } from "@/components/keyboard/useKeyboardList"

const rowOf = (handle: string) =>
  document.querySelector<HTMLElement>(
    `[data-directory-handle="${CSS.escape(handle)}"]`,
  )

/** The highlighted row's handle, or null. */
export function useDirectoryKeys({
  handles,
  open,
  onOpen,
  page,
  lastPage,
  onPage,
}: {
  /** The rows on screen, in order. */
  handles: string[]
  /** The handle whose panel is open. */
  open: string | null
  onOpen: (handle: string | null) => void
  page: number
  lastPage: number
  onPage: (page: number) => void
}): string | null {
  // After a page turn, the rows it was turned from: the Highlight lands on
  // the first row once different rows arrive.
  const turnedFrom = useRef<string | null>(null)
  const rowsKey = handles.join(" ")
  const { highlight, setHighlight } = useKeyboardList({
    list: "directory",
    items: handles,
    element: rowOf,
    reveal: (at) => rowOf(handles[at])?.scrollIntoView({ block: "nearest" }),
    name: (handle) => `@${handle}`,
    open: (handle) => onOpen(open ? null : handle),
    onMove: (handle) => {
      if (open) onOpen(handle)
    },
    onDrop: () => onOpen(null),
    key: (key) => {
      if (key !== "]" && key !== "[") return false
      const next = page + (key === "]" ? 1 : -1)
      if (next < 0 || next > lastPage) return false
      turnedFrom.current = rowsKey
      onPage(next)
      return true
    },
    search: () =>
      document.querySelector('input[aria-label="Search the Directory"]'),
  })

  const landing = useRef({ handles, open, onOpen, setHighlight })
  landing.current = { handles, open, onOpen, setHighlight }
  useEffect(() => {
    if (turnedFrom.current === null || turnedFrom.current === rowsKey) return
    turnedFrom.current = null
    const { handles, open, onOpen, setHighlight } = landing.current
    if (!handles.length) return
    setHighlight(handles[0])
    if (open) onOpen(handles[0])
  }, [rowsKey])

  return highlight
}
