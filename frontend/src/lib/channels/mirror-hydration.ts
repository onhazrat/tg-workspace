import * as cache from "@/lib/cache"
import { logger } from "@/lib/logger"

/**
 * Write the channel list to the IndexedDB mirror off the critical path.
 *
 * The mirror stays (DECISIONS.md §5 keeps it as the offline read cache), but
 * nothing the user is waiting on should block on it. Callers fire this and
 * return the rendered data immediately.
 *
 * Two properties matter:
 *
 * * **It never rejects.** A caller does `void hydrateChannelMirror(...)`, so a
 *   rejection would surface as an unhandled promise rejection. Mirror upkeep
 *   failing is not worth breaking a page over — the server data already rendered.
 * * **It does not pile up.** Repeated refreshes must not queue N overlapping
 *   bulk writes against the same store; a run already in flight is reused.
 */

let inFlight: Promise<void> | null = null

/** Deferred to an idle moment where supported, so it cannot compete with paint. */
function whenIdle(run: () => void): void {
  const idle = (
    globalThis as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
    }
  ).requestIdleCallback
  if (idle) idle(run, { timeout: 2_000 })
  else setTimeout(run, 0)
}

export function hydrateChannelMirror(
  channels: Parameters<typeof cache.saveChannels>[0],
): Promise<void> {
  if (inFlight) return inFlight

  inFlight = new Promise<void>((resolve) => {
    whenIdle(() => {
      cache
        .saveChannels(channels)
        .catch((error) => {
          // Housekeeping: the rendered data came from the server and is intact.
          logger.warn("[Cache] Channel mirror hydration failed", error)
        })
        .finally(() => {
          inFlight = null
          resolve()
        })
    })
  })

  return inFlight
}

/** Test-only: forget any in-flight run. */
export function __resetMirrorHydration(): void {
  inFlight = null
}
