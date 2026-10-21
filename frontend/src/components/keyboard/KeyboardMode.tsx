/**
 * Keyboard mode's engine (ADR-034): the workspace's one key listener. It runs
 * every keydown through the interpreter, applies the workspace's commands (the
 * switch, help, search, tabs) itself and hands list commands to the mounted
 * list (`useKeyboardList`). It also renders the screen reader's live region.
 */
import { useEffect, useRef } from "react"
import type { TabType } from "@/constants"
import { type Command, IDLE, interpret } from "@/lib/keyboard/interpreter"
import {
  keyboardOn,
  pending,
  setKeyboardMode,
  stepHelp,
  useAnnouncement,
} from "@/lib/keyboard/mode"
import { focusIsTyping } from "@/lib/keyboard-moves"
import { mountedList } from "./useKeyboardList"

/** The workspace's tab strip, as the keys use it. */
export interface WorkspaceKeyOps {
  /** The kind's most recent tab, as the strip's go-to does. */
  go: (kind: TabType) => void
  /** The next (1) or previous (-1) tab in the strip, by a count, wrapping. */
  step: (by: number) => void
  /** The strip's nth tab, 1 first; nothing past the end. */
  goToNth: (nth: number) => void
  /** Closes the active tab unless it is a Fixed tab. */
  close: () => void
  reopen: () => void
}

/** The full list is open and nothing else is: `\` and `?` still reach here. */
const onlyShortcutsOpen = () => {
  const dialogs = document.querySelectorAll('[role="dialog"]')
  return dialogs.length === 1 && dialogs[0].hasAttribute("data-shortcuts-list")
}

/** The corner list shows on a desk, on a tab with a list. */
const canCorner = () =>
  mountedList() !== null && window.matchMedia("(min-width: 768px)").matches

export function KeyboardMode({ ops }: { ops: WorkspaceKeyOps }) {
  const opsRef = useRef(ops)
  opsRef.current = ops

  // Bound once: the Channel spotlight's Esc listens after this one, so a
  // dropped Highlight (a taken key) comes before leaving the spotlight.
  useEffect(() => {
    const run = (command: Command): boolean => {
      const ops = opsRef.current
      const list = mountedList()
      switch (command.type) {
        case "mode":
          setKeyboardMode(!keyboardOn())
          return true
        case "help":
          stepHelp(canCorner())
          return true
        case "search": {
          const box = list?.search()
          box?.focus()
          box?.select()
          return Boolean(box)
        }
        case "tab":
          ops.go(command.kind)
          return true
        case "strip":
          ops.step(command.by)
          return true
        case "stripAt":
          ops.goToNth(command.nth)
          return true
        case "closeTab":
          ops.close()
          return true
        case "reopenTab":
          ops.reopen()
          return true
        default:
          return list?.run(command) ?? false
      }
    }
    const onKey = (e: KeyboardEvent) => {
      // A dialog that closed on this key took it (KM-01), and a modified key
      // is the browser's or the command palette's.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const dialog = document.querySelector('[role="dialog"]') !== null
      if (focusIsTyping()) {
        // Esc in a field gives the keys back.
        if (e.key === "Escape" && keyboardOn() && !dialog) {
          ;(document.activeElement as HTMLElement).blur()
          e.preventDefault()
        }
        return
      }
      if (dialog && !onlyShortcutsOpen()) return
      const step = interpret(pending.get(), e, {
        on: keyboardOn(),
        list: mountedList() !== null,
      })
      const type = step.command?.type
      // Over the full list only the switch and the next help step work.
      if (dialog && type !== "mode" && type !== "help") return
      pending.set(step.state)
      const done = step.command ? run(step.command) : false
      if (step.swallowed || done) e.preventDefault()
    }
    // A click cancels a waiting g or count.
    const onPointer = () => pending.set(IDLE)
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onPointer)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onPointer)
    }
  }, [])

  return <Announcer />
}

/** Each move, said politely to a screen reader: "@name, 6 of 20". */
function Announcer() {
  const text = useAnnouncement()
  return (
    <div
      role="status"
      aria-live="polite"
      className="sr-only"
      data-testid="keyboard-announcer"
    >
      {text}
    </div>
  )
}
