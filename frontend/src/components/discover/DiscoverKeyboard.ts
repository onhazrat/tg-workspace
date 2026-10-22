/**
 * A Discovery report's adapter on keyboard mode's engine (KM-03, ADR-034):
 * its Candidates, in order, and Enter for Details. The engine moves the
 * Highlight and presses the row control carrying a key's `data-shortcut`.
 *
 * Details stay a modal sheet, so the engine's moves wait while it is open and
 * the sheet's own Esc closes it.
 */
import { useKeyboardList } from "@/components/keyboard/useKeyboardList"

const rowOf = (name: string) =>
  document.querySelector<HTMLElement>(
    `[data-discover-handle="${CSS.escape(name)}"]`,
  )

/** The highlighted Candidate's name, or null. */
export function useDiscoverKeys({
  names,
  onOpen,
}: {
  /** The Candidates on screen, in order. */
  names: string[]
  /** Opens a Candidate's Details. */
  onOpen: (name: string) => void
}): string | null {
  return useKeyboardList({
    list: "discover",
    items: names,
    element: rowOf,
    reveal: (at) => rowOf(names[at])?.scrollIntoView({ block: "nearest" }),
    name: (name) => `@${name}`,
    open: onOpen,
    search: () =>
      document.querySelector('input[aria-label="Filter candidates by name"]'),
  }).highlight
}
