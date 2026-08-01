/**
 * Decisions the sync-job watcher makes about a `SyncJobStatus`.
 *
 * Extracted for T2, ahead of G1 splitting `ScraperContext` into `useSyncJob`.
 * These were closures inside a 1,103-line context with **no test coverage at
 * all**; the split has to preserve them exactly, and it cannot do that safely
 * while they are unreachable.
 *
 * Pure on purpose — no React, no network, no timers. That is the pattern this
 * repo already uses for the probe-queue decision
 * (`hooks/useDiscoverProbeQueue.ts`), and it avoids the process-wide
 * `mock.module` hazard T1 hit: mocking `@/api` would contaminate every other
 * test file that imports it.
 *
 * **Characterised as-is, warts included.** Where current behaviour looks odd it
 * is documented, not corrected — T2's contract is to pin behaviour, not improve
 * it.
 */

import type { SyncJobStatus } from "@/api"

/**
 * Statuses at which a job stops being watched.
 *
 * The same three strings were written out inline in three places
 * (`pollSyncJobFallback`, `waitSyncJob`, and the follow-job watcher), which is
 * exactly how one of them ends up missing a state later.
 */
export const TERMINAL_SYNC_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const

/**
 * Shared by the sync-job and follow-job watchers.
 *
 * Both jobs use the same three terminal states, and both spelled them out
 * inline — three copies in one file, which is how one of them ends up missing a
 * state after the backend gains a fourth.
 */
export function isTerminalSyncStatus(status: string): boolean {
  return (TERMINAL_SYNC_STATUSES as readonly string[]).includes(status)
}

/**
 * Channels to show as actively syncing.
 *
 * Note `pending` counts as active alongside `running`: a queued channel is part
 * of the in-flight job from the user's point of view, and dropping it would make
 * the spinner flicker off between channels.
 */
export function deriveScrapingChannels(status: SyncJobStatus): Set<string> {
  return new Set(
    status.channels
      .filter((ch) => ch.status === "running" || ch.status === "pending")
      .map((ch) => ch.channelName),
  )
}

/**
 * Whether any channel failed with something that reads as a rate limit.
 *
 * **Wart, preserved deliberately:** this is a regex over the error *string*
 * (`/rate limit/i`), not a status code. A backend wording change silently turns
 * the banner off, and an unrelated error mentioning the phrase turns it on. It
 * is characterised here rather than fixed, per T2's contract.
 */
export function hasRateLimitError(status: SyncJobStatus): boolean {
  return status.channels.some((ch) => ch.error && /rate limit/i.test(ch.error))
}

/**
 * Whether an aborted SSE stream should fall back to polling or give up.
 *
 * The distinction is the whole reliability story of the sync watcher: an abort
 * *we* triggered means the job outlived its timeout and must be cancelled, while
 * any other stream failure is a transport problem the poller can ride out.
 */
export function shouldFallBackToPolling(aborted: boolean): boolean {
  return !aborted
}
