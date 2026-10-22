/**
 * A Discovery report's adapter on keyboard mode's engine (KM-03, ADR-034):
 * its Candidates, in order, and Enter for Details. The engine moves the
 * Highlight and presses the row control carrying a key's `data-shortcut`.
 *
 * Details stay a modal sheet, so the engine's moves wait while it is open and
 * the sheet's own Esc closes it.
 */
import { useKeyboardList } from "@/components/keyboard/useKeyboardList"
import { ACTIONS } from "@/lib/keyboard/key-list"
import type { DiscoveryCandidate } from "@/lib/posts/discover-candidates"

const rowOf = (name: string) =>
  document.querySelector<HTMLElement>(
    `[data-discover-handle="${CSS.escape(name)}"]`,
  )

/** The highlighted Candidate's name, or null. */
export function useDiscoverKeys({
  report,
  names,
  onOpen,
  candidates,
  setIgnored,
}: {
  /** The report's id: each report tab remembers its own Highlight. */
  report: string | null
  /** The Candidates on screen, in order. */
  names: string[]
  /** Opens a Candidate's Details. */
  onOpen: (name: string) => void
  /** Every Candidate in the report, filtered out or not: whether each is dismissed. */
  candidates: readonly DiscoveryCandidate[]
  /** The Dismiss mutation's `mutate`, as the row's button calls it. */
  setIgnored: (change: { handles: string[]; ignored: boolean }) => void
}): string | null {
  return useKeyboardList({
    list: "discover",
    instance: report,
    items: names,
    element: rowOf,
    reveal: (at) => rowOf(names[at])?.scrollIntoView({ block: "nearest" }),
    name: (name) => `@${name}`,
    open: onOpen,
    // A dismissed row leaves the default view, so Undo cannot press it again.
    undo: (key, name) => {
      if (key !== ACTIONS.dismiss.key) return undefined
      const was = candidates.some((c) => c.name === name && c.isIgnored)
      return () => setIgnored({ handles: [name], ignored: was })
    },
    search: () =>
      document.querySelector('input[aria-label="Filter candidates by name"]'),
  }).highlight
}
