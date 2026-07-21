/**
 * A single module-level interval that many components can subscribe to.
 *
 * `RelativeTime` previously mounted one `setInterval` per instance, so a
 * 500-post feed scheduled 500 timers that all did the same thing at the same
 * cadence. One timer runs here, and only while something is subscribed.
 */

type Listener = () => void

const listeners = new Set<Listener>()
let intervalId: ReturnType<typeof setInterval> | null = null

/** How often subscribers are notified. */
export const TICK_INTERVAL_MS = 10_000

/** Fan out one tick. Exported so the fan-out is testable without waiting. */
export function notifyTick(): void {
  for (const listener of [...listeners]) listener()
}

function start(): void {
  if (intervalId !== null) return
  intervalId = setInterval(notifyTick, TICK_INTERVAL_MS)
}

function stop(): void {
  if (intervalId === null) return
  clearInterval(intervalId)
  intervalId = null
}

/** Subscribe to the shared tick. Returns an unsubscribe function. */
export function subscribeToTick(listener: Listener): () => void {
  listeners.add(listener)
  start()
  return () => {
    listeners.delete(listener)
    // No subscribers means no reason to keep waking the event loop.
    if (listeners.size === 0) stop()
  }
}

/** Test seam. */
export function tickerListenerCount(): number {
  return listeners.size
}

/** Test seam: whether the underlying timer is currently running. */
export function isTickerRunning(): boolean {
  return intervalId !== null
}
