import { useEffect, useRef } from "react"

import { deleteOldLogs, deleteOldPosts } from "@/lib/cache"

/** Wait for the app to settle before touching IndexedDB. */
const PRUNE_START_DELAY_MS = 30_000
/** Re-run cadence for long-lived sessions. */
export const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Prune the IndexedDB mirror to the configured retention window.
 *
 * `deleteOldPosts` / `deleteOldLogs` have existed since the browser-only era
 * but had **zero callers**, so the client mirror grew without bound and
 * diverged from the backend's own retention sweep — a browser could hold posts
 * years after the server dropped them.
 *
 * The backend sweep (backend/app/jobs/retention.py) covers the server side
 * only; its "replaces App.tsx 6h interval" note refers to a *different*,
 * genuinely removed interval. This is a real gap, not a duplicate.
 */
export function useCachePrune(
  postRetentionDays: number,
  logRetentionDays: number,
): void {
  // Read through a ref so changing a retention setting does not restart the
  // timer; the next scheduled run picks up the new value.
  const daysRef = useRef({ postRetentionDays, logRetentionDays })
  daysRef.current = { postRetentionDays, logRetentionDays }

  useEffect(() => {
    let cancelled = false

    const prune = async () => {
      if (cancelled) return
      const { postRetentionDays: posts, logRetentionDays: logs } =
        daysRef.current
      try {
        if (posts > 0) await deleteOldPosts(posts)
        if (logs > 0) await deleteOldLogs(logs)
      } catch (error) {
        // Pruning is housekeeping — never surface it to the user.
        console.error("[Cache] Prune failed", error)
      }
    }

    const startTimer = setTimeout(prune, PRUNE_START_DELAY_MS)
    const interval = setInterval(prune, PRUNE_INTERVAL_MS)

    return () => {
      cancelled = true
      clearTimeout(startTimer)
      clearInterval(interval)
    }
  }, [])
}
