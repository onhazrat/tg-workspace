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
  /**
   * Which tab of the list's kind this is, where there can be several (a
   * Discovery report's id), so each remembers its own Highlight.
   */
  instance?: string | null
  /** The actions shown now, for the corner list, when only some are. */
  carried?: readonly Action[]
  /** The items' ids, in order. */
  items: readonly string[]
  /** The item's element, to find its controls; null while it is not mounted. */
  element: (id: string) => HTMLElement | null
  /**
   * Brings the item at `index` into view; unset, its element scrolls to the
   * nearest edge. A list whose items unmount out of view scrolls its own way.
   */
  reveal?: (index: number) => void
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

/** Where a list's Highlight is kept: by list, and by tab where there are several. */
const memoryOf = ({ list, instance }: ListAdapter) =>
  instance ? `${list}:${instance}` : list

const reveal = (adapter: ListAdapter, index: number) =>
  adapter.reveal
    ? adapter.reveal(index)
    : adapter
        .element(adapter.items[index])
        ?.scrollIntoView({ block: "nearest" })

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

/**
 * Presses a control: a field gets the cursor. A control the deployment
 * refuses (`data-refusal`, RKD-02) is off, so its key says why instead.
 */
function press(control: HTMLElement | null): boolean {
  if (!control) return false
  const refusal = control.dataset.refusal
  if (refusal && control.matches(":disabled"))
    toast(refusal, { id: "keyboard-refused" })
  else if (control instanceof HTMLInputElement && control.type !== "checkbox")
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
 * F / D: the bulk bar's own button, so its confirmation asks as a click's
 * does; with no button there is nothing ticked to act on. A disabled button
 * says why, from the tooltip the mouse reads.
 */
function bulk(key: "F" | "D"): boolean {
  const button = document.querySelector<HTMLElement>(
    `[data-bulk-shortcut="${key}"]`,
  )
  if (button && !button.matches(":disabled")) {
    button.click()
    return true
  }
  const label = button?.textContent?.trim()
  const why = button?.closest("[title]")?.getAttribute("title")
  toast(
    !button
      ? `Nothing selected to ${key === "F" ? "follow" : "dismiss"}`
      : `${label} is off${why ? `: ${why}` : " right now"}`,
    { id: "keyboard-bulk" },
  )
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
  // Held with the tab it is on: two report tabs share one mounted view, so a
  // switch between them changes `instance` and the Highlight goes with it.
  const memory = memoryOf(adapter)
  const [held, setHeld] = useState<{ memory: string; id: string | null }>({
    memory,
    id: null,
  })
  const highlight = held.memory === memory ? held.id : null
  const ref = useRef({ adapter, highlight })
  ref.current = { adapter, highlight }

  const setHighlight = (id: string | null) => {
    ref.current.highlight = id
    const memory = memoryOf(ref.current.adapter)
    setHeld({ memory, id })
    if (id) lastHighlight.set(memory, id)
    else lastHighlight.delete(memory)
  }
  const setRef = useRef(setHighlight)
  setRef.current = setHighlight

  // The Highlight left on this tab before a tab switch, once its item loads.
  const restored = useRef({ memory, done: false })
  const remembered = lastHighlight.get(memory)
  const at = remembered ? adapter.items.indexOf(remembered) : -1
  useEffect(() => {
    if (restored.current.memory !== memory)
      restored.current = { memory, done: false }
    if (restored.current.done || highlight || !remembered || at < 0) return
    restored.current.done = true
    setHeld({ memory, id: remembered })
    reveal(ref.current.adapter, at)
  }, [memory, remembered, at, highlight])

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
      reveal(adapter, index)
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
        case "sweep":
          return sweep(command.by)
        case "bulk":
          return offers(adapter.list, "follow") && bulk(command.key)
        case "act":
          if (adapter.key?.(command.key, highlight)) return true
          return highlight !== null && act(adapter, highlight, command.key)
        default:
          return false
      }
    }
    /** J / K: the Highlight and the item moved to get the last x's state. */
    const sweep = (by: 1 | -1) => {
      const { adapter, highlight } = ref.current
      if (!offers(adapter.list, "tick")) return false
      if (highlight) tickTo(adapter.element(highlight))
      if (!run({ type: "move", by })) return false
      const now = ref.current.highlight
      if (now) tickTo(adapter.element(now))
      return true
    }
    /** A key on the Highlight: press its control, said in a toast for d and *. */
    const act = (adapter: ListAdapter, id: string, key: string) => {
      const control = controlOf(adapter.element(id), key)
      if (!control) return false
      if (key === ACTIONS.tick.key) ticking = !isOn(control)
      if (SAID.includes(key)) {
        const again = () => press(controlOf(adapter.element(id), key))
        say(control, adapter.name(id), adapter.undo?.(key, id) ?? again)
      }
      return press(control)
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
