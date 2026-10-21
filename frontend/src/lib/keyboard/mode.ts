/**
 * What keyboard mode shares across the workspace: the one switch, the help's
 * state, what a `g` or count waits for, the announcer's line and each list's
 * last Highlight. Module stores rather than context: the engine's one key
 * listener and the controls' tooltips read them alike, and only one list is
 * mounted at a time, so a Highlight kept across a tab switch cannot live in
 * the list.
 */
import { useSyncExternalStore } from "react"
import { scopedSessionStorage } from "@/lib/storage/scoped"
import { IDLE, type KeyState } from "./interpreter"
import type { Action, ListId } from "./key-list"

function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }
  return {
    get: () => value,
    set: (next: T) => {
      if (Object.is(next, value)) return
      value = next
      for (const l of listeners) l()
    },
    use: () => useSyncExternalStore(subscribe, () => value),
    subscribe,
  }
}

// ---- the switch: one for every tab, for the browser session ----

const MODE_KEY = "keyboard"
/** Bumped on every write, so a reader re-reads the per-Account session flag. */
const modeWrites = store(0)
export const keyboardOn = () => scopedSessionStorage.getItem(MODE_KEY) === "1"
export function setKeyboardMode(on: boolean) {
  scopedSessionStorage.setItem(MODE_KEY, on ? "1" : "0")
  pending.set(IDLE)
  modeWrites.set(modeWrites.get() + 1)
}
export const useKeyboardMode = () =>
  useSyncExternalStore(modeWrites.subscribe, keyboardOn)

// ---- help: closed, the tab's keys in the corner, or the full list ----

export type HelpState = "closed" | "corner" | "full"
const help = store<HelpState>("closed")
/** With keyboard mode off, `?` opens the full list on its own. */
const adhoc = store(false)
export const useHelp = help.use
export const useAdhocHelp = adhoc.use
export const setHelp = help.set
export const setAdhocHelp = adhoc.set

/**
 * One step of `?` and of the shortcuts button. In keyboard mode: closed, the
 * corner (skipped where it would show nothing), the full list, closed. Out of
 * it, the full list on and off, leaving the steps as they were.
 */
export function stepHelp(canCorner: boolean) {
  if (!keyboardOn()) return adhoc.set(!adhoc.get())
  const now = help.get()
  help.set(
    now === "closed"
      ? canCorner
        ? "corner"
        : "full"
      : now === "corner"
        ? "full"
        : "closed",
  )
}

/** Whether the full list is open now. */
export const fullListOpen = (on: boolean, state: HelpState, alone: boolean) =>
  on ? state === "full" : alone

// ---- what a `g` or count waits for, shown above the corner ----

export const pending = store<KeyState>(IDLE)
export const usePending = pending.use

// ---- the screen reader's line ----

export const announcement = store("")
export const useAnnouncement = announcement.use

// ---- the list on screen, for the corner list ----

export const shownList = store<{
  list: ListId
  carried?: readonly Action[]
} | null>(null)
export const useShownList = shownList.use

// ---- each list's Highlight, kept across a tab switch ----

export const lastHighlight = new Map<ListId, string>()
