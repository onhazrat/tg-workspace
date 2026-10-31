/**
 * A sync started from the live banner, before any action (CW-01). Module
 * state rather than a component's, so "Syncing 162…" survives a tab switch.
 * The gate joins it as it joins any sync in flight, through the check.
 */

import { useSyncExternalStore } from "react"

export interface BannerSync {
  names: ReadonlySet<string>
}

let running: BannerSync | null = null
const listeners = new Set<() => void>()

export function setBannerSync(next: BannerSync | null) {
  running = next
  for (const listener of listeners) listener()
}

export const useBannerSync = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => running,
  )
