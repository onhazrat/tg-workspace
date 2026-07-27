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
  startDate: number
  endDate: number
}

/** `Scope set to 12 channels, Jul 24, 2026, 11:54 PM – Jul 25, 2026, 12:24 AM`. */
export function restoredScopeNotice(
  scope: RestoredScope,
  locale?: string,
): string {
  const channels = countOf(scope.channelCount, "channel")
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
