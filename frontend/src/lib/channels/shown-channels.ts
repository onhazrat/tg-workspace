import { useSyncExternalStore } from "react"

/**
 * The Channels tab's Shown Channels, published for the command palette
 * (CTB-04), whose selection edits are relative to them. The Channel filter
 * lives in the URL, but the channel search and the metric values do not, so
 * the tab that computes the set is the one place that can answer. `null`
 * while the tab is not mounted: the palette then has nothing to edit against.
 *
 * `useSyncExternalStore` for the same reason as `aiKeys/selection.ts`: the
 * palette's provider sits above the tab, so a context the tab provides could
 * never reach it.
 */
let shown: string[] | null = null
const listeners = new Set<() => void>()

export function publishShownChannels(names: string[] | null): void {
  shown = names
  for (const notify of listeners) notify()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

export function useShownChannels(): string[] | null {
  return useSyncExternalStore(
    subscribe,
    () => shown,
    () => null,
  )
}
