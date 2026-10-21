/**
 * PROTOTYPE (variant F), throw away. What F adds to every tab's keyboard:
 * counts for moves (5j, 7k, 37G), the pending g's pop-up, J / K and the bulk
 * capitals following the last x, a confirmation for keys that act on what you
 * may not see, and a screen reader voice for the highlight.
 */
import { useSyncExternalStore } from "react"
import { toast } from "sonner"
import { MODIFIERS, type Move } from "@/lib/keyboard-moves"
import { since, variantNow } from "./variant"

export const isF = () => since(variantNow(), "F")

// ---- the pending g and count, a store the pop-up reads ----

let gPending = false
let count = ""
const listeners = new Set<() => void>()
const notify = () => {
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function setGPending(on: boolean) {
  if (on && !isF()) return
  if (gPending === on) return
  gPending = on
  notify()
}
export const gPendingNow = () => gPending
export const useGPending = () => useSyncExternalStore(subscribe, () => gPending)
export const useCount = () => useSyncExternalStore(subscribe, () => count)

/**
 * Whether the g pressed at `lastG` still waits. In F it waits until answered
 * (its pop-up says what it waits for), and the shared pending g
 * decides, so whatever cancels it (Esc, ?, a click, another key) cancels it
 * for every tab's keyboard, whatever each remembers; before F, the window.
 */
export const gLive = (lastG: number, now: number, ms: number) =>
  lastG > 0 && (isF() ? gPending : now - lastG < ms)

/**
 * F, first in every tab's keyboard: digits build a count, and Esc cancels a
 * pending count or g. True when the key was one of those.
 */
export function prefixKey(e: KeyboardEvent, lastG: { current: number }) {
  if (!isF()) return false
  // A modifier's own keydown (the Shift of 23G) is no key yet: it keeps a
  // count and a pending g, and nothing reads it.
  if (MODIFIERS.has(e.key)) return true
  if (/^[0-9]$/.test(e.key) && !(count === "" && e.key === "0")) {
    // A pending g stays pending: g3t takes its count after the g.
    count += e.key
    notify()
    e.preventDefault()
    return true
  }
  if (e.key === "Escape" && (count || gPending)) {
    count = ""
    lastG.current = 0
    gPending = false
    notify()
    e.preventDefault()
    return true
  }
  return false
}

/** The count typed before a move, used up; null for none. */
export function takeCount(): number | null {
  if (!count) return null
  const n = Number(count)
  count = ""
  notify()
  return n
}
export function clearCount() {
  if (!count) return
  count = ""
  notify()
}

/**
 * Where a move with a count lands: j / k that many steps, G and gg the
 * count's item (37G is the 37th), each stopping at the ends.
 */
export function stepIndex(
  at: number,
  move: Move,
  length: number,
  n: number | null,
): number {
  const clamp = (i: number) => Math.max(0, Math.min(length - 1, i))
  if (move === "first") return clamp(n ? n - 1 : 0)
  if (move === "last") return clamp(n ? n - 1 : length - 1)
  return clamp(at + (move === "j" ? 1 : -1) * (n ?? 1))
}

// ---- x, J / K and the bulk capitals ----

/** Whether the last x selected (true) or deselected; J / K follow it. */
let lastXSelected = true

const isOn = (control: HTMLElement) =>
  control instanceof HTMLInputElement
    ? control.checked
    : control.getAttribute("aria-pressed") === "true"

/** J / K: the item gets the last x's state, selected or not. */
export function ensureSelection(item: Element | null | undefined) {
  const control = item?.querySelector<HTMLElement>('[data-shortcut="x"]')
  if (!control || isOn(control) === lastXSelected) return
  control.click()
}
export const extendVerb = () => (lastXSelected ? "Selecting" : "Deselecting")

/**
 * F: Shift + a letter acts on everything selected, through the bulk bar's own
 * button (which asks first where it already does).
 */
export function bulkKey(key: string): boolean {
  if (!isF() || (key !== "F" && key !== "D")) return false
  const button = document.querySelector<HTMLElement>(
    `[data-bulk-shortcut="${key}"]:not(:disabled)`,
  )
  if (button) button.click()
  else toast("Nothing selected to act on", { id: "kbd-bulk" })
  return true
}

// ---- what a key did, said out loud ----

/** A highlighted item's name, for the toast and the screen reader. */
export function itemName(item: Element | null | undefined): string {
  if (!(item instanceof HTMLElement)) return "this item"
  const { channelName, directoryHandle, postKey } = item.dataset
  if (channelName) return `@${channelName}`
  if (postKey)
    return `a post from @${postKey.slice(0, postKey.lastIndexOf("_"))}`
  if (directoryHandle?.includes(":")) {
    // A History card: its kind, then the title after the heading's chips.
    const heading = item.querySelector("button")
    const title = [...(heading?.children ?? [])]
      .slice(1)
      .map((c) => c.textContent?.trim())
      .join(" ")
      .trim()
    const kind = directoryHandle.split(":")[0] ?? ""
    const shown = title.length > 40 ? `${title.slice(0, 40)}…` : title
    return `${kind[0]?.toUpperCase()}${kind.slice(1)}: ${shown || "untitled"}`
  }
  if (directoryHandle) return `@${directoryHandle}`
  return "this item"
}

/** The attribute that finds an item again, for Undo. */
function finder(item: HTMLElement): string | null {
  for (const attr of ["channelName", "directoryHandle", "postKey"] as const) {
    const value = item.dataset[attr]
    if (value) {
      const name = attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      return `[data-${name}="${CSS.escape(value)}"]`
    }
  }
  return null
}

/**
 * Press a control for a pressed key, as the tabs did, and in F say what it
 * did: x (and its direction for J / K), d and * get a toast with Undo, which
 * presses the same control again.
 */
export function pressControl(
  key: string,
  item: HTMLElement,
  control: HTMLElement,
) {
  const before =
    control.getAttribute("aria-label") || control.textContent?.trim()
  const wasOn = isOn(control)
  if (control instanceof HTMLInputElement && control.type !== "checkbox")
    control.focus()
  else control.click()
  if (!isF()) return
  if (key === "x") lastXSelected = !wasOn
  if (key !== "x" && key !== "d" && key !== "*") return
  const what =
    key === "x" ? (wasOn ? "Deselected" : "Selected") : (before ?? "Done")
  const found = finder(item)
  const letter = control.dataset.shortcut
  const name = itemName(item)
  // A control's own label may name the item already ("Dismiss @handle").
  toast(what.includes(name) ? what : `${what} · ${name}`, {
    id: "kbd-action",
    action:
      found && letter
        ? {
            label: "Undo",
            onClick: () =>
              document
                .querySelector(found)
                ?.querySelector<HTMLElement>(
                  `[data-shortcut="${CSS.escape(letter)}"]`,
                )
                ?.click(),
          }
        : undefined,
  })
}

/** J / K's running toast, one that updates as the move goes on. */
export function extendToast(item: Element | null | undefined) {
  if (isF())
    toast(`${extendVerb()} while moving · ${itemName(item)}`, {
      id: "kbd-extend",
    })
}

// ---- the screen reader's voice ----

let live: HTMLElement | null = null
/** F: says where the highlight is, politely, to a screen reader. */
export function announce(
  item: Element | null | undefined,
  at: number,
  of: number,
) {
  if (!isF()) return
  if (!live) {
    live = document.createElement("div")
    live.setAttribute("aria-live", "polite")
    live.setAttribute("role", "status")
    live.className = "sr-only"
    live.dataset.testid = "keyboard-announcer"
    document.body.append(live)
  }
  live.textContent = `${itemName(item)}, ${at + 1} of ${of}`
}
