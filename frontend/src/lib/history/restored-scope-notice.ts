import { formatDateRange } from "@/lib/format-date-range"
import { countOf } from "@/lib/plural"

/**
 * Says out loud what opening a saved report just changed.
 *
 * `applyHistorySummarySelection` calls `setSelectedChannels` and `setDateRange`
 * — deliberately, because a report only makes sense beside the posts it was
 * generated from. But it happened with nothing on screen to say so, and the
 * figures it drives (the "Posts in Scope" counter, the Posts feed, Discover)
 * changed underneath the user with no explanation. That is the whole of C8: the
 * mutation is correct, the silence is not.
 */

export type RestoredScope = {
  channelCount: number
  /**
   * `null` when the Artifact carried no window (AW-02).
   *
   * Such an Artifact predates the frozen-Scope contract, and `(0, 0)` is not a
   * window the server will accept, so opening one leaves the workspace's range
   * alone. The notice then has to leave it alone too — naming a range that was
   * not restored would describe a selection nothing is querying.
   */
  startDate: number | null
  endDate: number | null
}

/** `Scope set to 12 channels, Jul 24, 2026, 11:54 PM – Jul 25, 2026, 12:24 AM`. */
export function restoredScopeNotice(
  scope: RestoredScope,
  locale?: string,
): string {
  const channels = countOf(scope.channelCount, "channel")
  if (scope.startDate == null || scope.endDate == null) {
    return `Scope set to ${channels}; this one saved no date range, so yours is unchanged`
  }
  const range = formatDateRange(
    new Date(scope.startDate),
    new Date(scope.endDate),
    locale,
  )
  return `Scope set to ${channels}, ${range}`
}

/**
 * A report saved with no channels still replaced the selection — with nothing.
 * Worth naming explicitly rather than rendering "Scope set to 0 channels".
 */
export function isEmptyScope(scope: RestoredScope): boolean {
  return scope.channelCount === 0
}
