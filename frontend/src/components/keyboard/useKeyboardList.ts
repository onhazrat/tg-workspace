/**
 * Keyboard mode's list driver (ADR-034): it holds one list's Highlight and
 * applies the interpreter's list commands to it through the list's adapter. A
 * list says what its items are and how to reach them; it handles no keys.
 *
 * Only one list is mounted at a time, so the driver registers itself in one
 * slot the workspace's engine (`KeyboardMode`) sends list commands to.
 */
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { Command } from "@/lib/keyboard/interpreter"
import {
  ACTIONS,
  type Action,
  type ListId,
  offers,
} from "@/lib/keyboard/key-list"
import {
  announcement,
  lastHighlight,
  shownList,
  useKeyboardMode,
} from "@/lib/keyboard/mode"

export interface ListAdapter {
  list: ListId
  /** The actions shown now, for the corner list, when only some are. */
  carried?: readonly Action[]
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
  /**
   * Undo for d or * on an item, read before the press. Without it Undo
   * presses the same control again, which needs the item still on screen.
   */
  undo?: (key: string, id: string) => (() => void) | undefined
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

const controlOf = (item: HTMLElement | null, key: string) =>
  item?.querySelector<HTMLElement>(`[data-shortcut="${CSS.escape(key)}"]`) ??
  null

/** A tick control is on: a checked box, or a pressed toggle. */
const isOn = (control: HTMLElement) =>
  control instanceof HTMLInputElement
    ? control.checked
    : control.getAttribute("aria-pressed") === "true"

/** Presses a control: a field gets the cursor. */
function press(control: HTMLElement | null): boolean {
  if (!control) return false
  if (control instanceof HTMLInputElement && control.type !== "checkbox")
    control.focus()
  else control.click()
  return true
}

/** The keys whose press is said in a toast, since it acts on what may be out of sight. */
const SAID: string[] = [ACTIONS.dismiss.key, ACTIONS.star.key]

/**
 * The toast for d or *: the control's own label (as it read before the
 * press) and the item, with Undo. A control marked `data-says` toasts its
 * own outcome, with its own Undo, so the keys add none.
 */
function say(control: HTMLElement, name: string, undo: () => void) {
  if (control.hasAttribute("data-says")) return
  const label =
    control.getAttribute("aria-label") || control.textContent?.trim() || ""
  toast(label.includes(name) ? label : `${label} · ${name}`, {
    id: "keyboard-action",
    action: { label: "Undo", onClick: undo },
  })
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
    // J / K follow the last x: ticking, or unticking when it unticked.
    let ticking = true
    const tickTo = (item: HTMLElement | null) => {
      const tick = controlOf(item, ACTIONS.tick.key)
      if (tick && isOn(tick) !== ticking) tick.click()
    }
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
        case "sweep": {
          if (!offers(adapter.list, "tick")) return false
          if (highlight) tickTo(adapter.element(highlight))
          if (!run({ type: "move", by: command.by })) return false
          const now = ref.current.highlight
          if (now) tickTo(adapter.element(now))
          return true
        }
        case "bulk": {
          if (!offers(adapter.list, "follow")) return false
          // The bar's own button, so its confirmation asks as a click's does.
          const button = document.querySelector<HTMLElement>(
            `[data-bulk-shortcut="${command.key}"]`,
          )
          if (button) button.click()
          else
            toast(
              `Nothing ticked to ${command.key === "F" ? "follow" : "dismiss"}`,
              { id: "keyboard-bulk" },
            )
          return true
        }
        case "act": {
          if (adapter.key?.(command.key, highlight)) return true
          if (highlight === null) return false
          const { key } = command
          const control = controlOf(adapter.element(highlight), key)
          if (!control) return false
          if (key === ACTIONS.tick.key) ticking = !isOn(control)
          if (SAID.includes(key)) {
            const again = () =>
              press(controlOf(adapter.element(highlight), key))
            say(
              control,
              adapter.name(highlight),
              adapter.undo?.(key, highlight) ?? again,
            )
          }
          return press(control)
        }
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

  // What the corner list shows: this list's keys, those its items carry.
  const carriedKey = adapter.carried?.join(" ")
  useEffect(() => {
    const shown = { list: adapter.list, carried: ref.current.adapter.carried }
    shownList.set(shown)
    return () => {
      if (shownList.get() === shown) shownList.set(null)
    }
  }, [adapter.list, carriedKey])

  return { highlight: on ? highlight : null, setHighlight }
}
