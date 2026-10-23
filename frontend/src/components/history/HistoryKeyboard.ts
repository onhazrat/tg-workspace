/**
 * History's adapter on keyboard mode's engine (KM-03, ADR-034): its Artifacts,
 * in order, Enter to open one in its tab, and - or + for the Compact grid as
 * on Posts. The engine moves the Highlight and presses the card control
 * carrying a key's `data-shortcut` (* and n); delete carries none, so no key
 * deletes (ADR-034).
 */
import { useKeyboardList } from "@/components/keyboard/useKeyboardList"
import { LIST_KEYS } from "@/lib/keyboard/key-list"
import type { ArtifactListItem } from "@/types"
import { artifactKey, artifactName } from "./artifact-presentation"

const cardOf = (key: string) => {
  const [kind, id] = key.split(/:(.*)/)
  return document.querySelector<HTMLElement>(
    `[data-artifact-kind="${CSS.escape(kind)}"][data-artifact-id="${CSS.escape(id)}"]`,
  )
}

/** The highlighted Artifact's `kind:id`, or null. */
export function useHistoryKeys({
  artifacts,
  onOpen,
  onCompact,
}: {
  /** The Artifacts on screen, in order. */
  artifacts: ArtifactListItem[]
  onOpen: (artifact: ArtifactListItem) => void
  /** - and +: the Compact grid on or off. */
  onCompact: (compact: boolean) => void
}): string | null {
  const keys = artifacts.map(artifactKey)
  const find = (key: string) => artifacts[keys.indexOf(key)]
  return useKeyboardList({
    list: "history",
    items: keys,
    element: cardOf,
    name: (key) => artifactName(find(key)),
    open: (key) => onOpen(find(key)),
    key: (key) => {
      if (key !== LIST_KEYS.smaller && key !== LIST_KEYS.larger) return false
      onCompact(key === LIST_KEYS.smaller)
      return true
    },
    search: () => document.querySelector('input[aria-label="Search history"]'),
  }).highlight
}
