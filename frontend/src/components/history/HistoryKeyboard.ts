/**
 * History's adapter on keyboard mode's engine (KM-03, ADR-034): its Artifacts,
 * in order, and Enter to open one in its tab. The engine moves the Highlight
 * and presses the card control carrying a key's `data-shortcut` (* and n);
 * delete carries none, so no key deletes (ADR-034).
 */
import { useKeyboardList } from "@/components/keyboard/useKeyboardList"
import type { ArtifactListItem } from "@/types"
import { artifactName } from "./artifact-presentation"

/** An Artifact's id in the list: `kind:id`, since ids are per kind. */
export const artifactKey = (a: ArtifactListItem) => `${a.kind}:${a.id}`

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
}: {
  /** The Artifacts on screen, in order. */
  artifacts: ArtifactListItem[]
  onOpen: (artifact: ArtifactListItem) => void
}): string | null {
  const keys = artifacts.map(artifactKey)
  const find = (key: string) => artifacts[keys.indexOf(key)]
  return useKeyboardList({
    list: "history",
    items: keys,
    element: cardOf,
    name: (key) => artifactName(find(key)),
    open: (key) => onOpen(find(key)),
    search: () => document.querySelector('input[aria-label="Search history"]'),
  }).highlight
}
