/**
 * In-flight request de-duplication.
 *
 * Staleness is tracked as a single global etag per resource with no
 * coordination between callers, so concurrent readers of the same resource
 * each fired their own identical request. Posts were worst: six direct call
 * sites and no TanStack Query coverage. Callers arriving while a request is
 * outstanding now await that same promise.
 *
 * Entries are removed once settled, so this is a de-duplicator, not a cache —
 * it never serves a stale value to a later caller.
 */
const inFlight = new Map<string, Promise<unknown>>()

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>

  const promise = fn().finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}

/** Test seam: drop any outstanding de-dup entries. */
export function resetInFlight(): void {
  inFlight.clear()
}
