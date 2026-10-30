/**
 * A sync started from the live banner, before any action (CW-01). Module
 * state rather than a context, so the gate (CW-02) can join it: it shortens
 * the gate's sync, never replaces it.
 */

import { useSyncExternalStore } from "react"

export interface BannerSync {
  names: ReadonlySet<string>
  startedAt: number
  /** Settles when the sync ends, however it ends: the gate waits on it. */
  job?: Promise<void>
}

let running: BannerSync | null = null
const listeners = new Set<() => void>()

export function setBannerSync(next: BannerSync | null) {
  running = next
  for (const listener of listeners) listener()
}

export const bannerSync = () => running

export const useBannerSync = () =>
  useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, bannerSync)
