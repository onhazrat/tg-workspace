/**
 * Keyboard mode's list driver (ADR-034): it holds one list's Highlight and
 * applies the interpreter's list commands to it through the list's adapter. A
 * list says what its items are and how to reach them; it handles no keys.
 *
 * Only one list is mounted at a time, so the driver registers itself in one
 * slot the workspace's engine (`KeyboardMode`) sends list commands to.
 */
import { useEffect, useRef, useState } from "react"
import type { Command } from "@/lib/keyboard/interpreter"
import type { ListId } from "@/lib/keyboard/key-list"
import {
  announcement,
  lastHighlight,
  useKeyboardMode,
} from "@/lib/keyboard/mode"

export interface ListAdapter {
  list: ListId
  /** The items' ids, in order. */
  items: readonly string[]
  /** The item's element, to find its controls; null while it is not mounted. */
  element: (id: string) => HTMLElement | null
  /** Brings the item at `index` into view. */
  reveal: (index: number) => void
  /** The item's name for a screen reader: "@name". */
  name: (id: string) => string
  /** Where j / k land with no Highlight yet: the first item on screen. */
  start?: () => number
  /** Enter, on the Highlight. */
  open?: (id: string) => void
  /** The list's own keys (- and +, ] and [), before its controls'; true when taken. */
  key?: (key: string, highlight: string | null) => boolean
  /** After every move, with the new Highlight. */
  onMove?: (id: string) => void
  /** After Esc. */
  onDrop?: () => void
  /** The tab's search box, which / puts the cursor in. */
  search?: () => HTMLInputElement | null
}

export interface MountedList {
  run: (command: Command) => boolean
  search: () => HTMLInputElement | null
}

let mounted: MountedList | null = null
/** The list the engine sends list commands to, if a tab with one is shown. */
export const mountedList = () => mounted

const clamp = (i: number, length: number) =>
  Math.max(0, Math.min(length - 1, i))

/** Presses the control carrying `key` in `item`: a field gets the cursor. */
function press(item: HTMLElement | null, key: string): boolean {
  const control = item?.querySelector<HTMLElement>(
    `[data-shortcut="${CSS.escape(key)}"]`,
  )
  if (!control) return false
  if (control instanceof HTMLInputElement && control.type !== "checkbox")
    control.focus()
  else control.click()
  return true
}

/**
 * The list's Highlight while keyboard mode is on, and a way to set it (a page
 * turn landing on the first row). The Highlight comes back after a tab switch
 * once its item is among `items`.
 */
export function useKeyboardList(adapter: ListAdapter): {
  highlight: string | null
  setHighlight: (id: string | null) => void
} {
  const on = useKeyboardMode()
  const [highlight, setHighlightState] = useState<string | null>(null)
  const ref = useRef({ adapter, highlight })
  ref.current = { adapter, highlight }

  const setHighlight = (id: string | null) => {
    ref.current.highlight = id
    setHighlightState(id)
    const { list } = ref.current.adapter
    if (id) lastHighlight.set(list, id)
    else lastHighlight.delete(list)
  }
  const setRef = useRef(setHighlight)
  setRef.current = setHighlight

  // The Highlight left on this list before a tab switch, once its item loads.
  const restored = useRef(false)
  const remembered = lastHighlight.get(adapter.list)
  const at = remembered ? adapter.items.indexOf(remembered) : -1
  useEffect(() => {
    if (restored.current || highlight || !remembered || at < 0) return
    restored.current = true
    setHighlightState(remembered)
    ref.current.adapter.reveal(at)
  }, [remembered, at, highlight])

  useEffect(() => {
    const moveTo = (index: number) => {
      const { adapter } = ref.current
      const id = adapter.items[index]
      setRef.current(id)
      adapter.reveal(index)
      adapter.onMove?.(id)
      announcement.set(
        `${adapter.name(id)}, ${index + 1} of ${adapter.items.length}`,
      )
      return true
    }
    const run = (command: Command): boolean => {
      const { adapter, highlight } = ref.current
      const { items } = adapter
      const at = highlight ? items.indexOf(highlight) : -1
      switch (command.type) {
        case "move": {
          if (!items.length) return false
          if (at >= 0) return moveTo(clamp(at + command.by, items.length))
          // The first move lands on the first item on screen.
          const start = adapter.start?.() ?? 0
          const by = command.by - Math.sign(command.by)
          return moveTo(clamp(start + by, items.length))
        }
        case "goto":
          if (!items.length) return false
          return moveTo(
            command.nth === "last"
              ? items.length - 1
              : clamp(command.nth - 1, items.length),
          )
        case "open":
          if (!highlight || !adapter.open) return false
          adapter.open(highlight)
          return true
        case "drop":
          adapter.onDrop?.()
          if (!highlight) return false
          setRef.current(null)
          return true
        case "act":
          if (adapter.key?.(command.key, highlight)) return true
          return (
            highlight !== null && press(adapter.element(highlight), command.key)
          )
        default:
          return false
      }
    }
    const self: MountedList = {
      run,
      search: () => ref.current.adapter.search?.() ?? null,
    }
    mounted = self
    return () => {
      if (mounted === self) mounted = null
    }
  }, [])

  return { highlight: on ? highlight : null, setHighlight }
}
