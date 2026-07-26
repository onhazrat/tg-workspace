/**
 * Whether a cached figure is old enough that presenting it plainly would mislead.
 *
 * Table sizes are computed on demand and cached, so the panel can show a
 * five-day-old row count as if it were current. The timestamp was already
 * displayed; nothing marked it as stale.
 */

/** Past this age, a cached figure is called out rather than shown plainly. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000

export function isStaleCalculation(
  lastCalculated: number | null | undefined,
  now: number = Date.now(),
  staleAfterMs: number = STALE_AFTER_MS,
): boolean {
  if (!lastCalculated) return false
  return now - lastCalculated > staleAfterMs
}
