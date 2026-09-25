/**
 * The pieces `DiscoverView` is assembled from. Each takes props only; the view
 * keeps the contexts, the report query and the follow job.
 */
import type React from "react"
import type { FollowJobStatus } from "@/api"
import { GoToActionEmptyState } from "@/components/history/GoToActionEmptyState"
import type {
  DiscoverFollowState,
  DiscoverSignalWeights,
  DiscoverSortKey,
} from "@/lib/posts/discover-candidates"
import type {
  DiscoveryEmptyState,
  DiscoveryQuickAction,
} from "@/lib/posts/discover-empty-state"
import { DiscoverEmptyState } from "./DiscoverEmptyState"
import { DiscoverSortChips } from "./DiscoverSortChips"
import { DiscoverWeightsEditor } from "./DiscoverWeightsEditor"

/** What the bulk bar needs from the selection, or `null` when it is hidden. */
export interface DiscoverBulkState {
  selectedCount: number
  isFollowJobRunning: boolean
  dismissMode: "dismiss" | "restore"
  showRecheck: boolean
}

/**
 * The bulk bar shows while rows are on screen and some are selected.
 *
 * It reads as running when any selected name is mid-follow, not when any job
 * runs: rows lock one by one, so an unrelated follow must not grey it out.
 * Viewing "Ignored" turns Dismiss into Restore, and only "Not followable"
 * offers a bulk recheck.
 */
export function discoverBulkState({
  candidateCount,
  selected,
  activeFollowNames,
  followState,
}: {
  candidateCount: number
  selected: Set<string>
  activeFollowNames: string[]
  followState: DiscoverFollowState
}): DiscoverBulkState | null {
  if (candidateCount === 0 || selected.size === 0) return null
  return {
    selectedCount: selected.size,
    isFollowJobRunning: [...selected].some((name) =>
      activeFollowNames.includes(name),
    ),
    dismissMode: followState === "ignored" ? "restore" : "dismiss",
    showRecheck: followState === "unavailable",
  }
}

/** The bulk-follow confirmation's body, empty while no follow is pending. */
export function followConfirmDescription(names: string[] | null): string {
  if (!names) return ""
  return `Follow ${names.length} channels? This will scrape and add each selected source.`
}

/** "Channel Candidates (n)", with the sort chips and, for a weighted sort, the weights. */
export function CandidatesHeading({
  count,
  sortKey,
  onSortKeyChange,
  weights,
  onWeightsChange,
}: {
  count: number
  sortKey: DiscoverSortKey
  onSortKeyChange: (key: DiscoverSortKey) => void
  weights: DiscoverSignalWeights
  onWeightsChange: (weights: DiscoverSignalWeights) => void
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-bold uppercase tracking-widest text-app-ink/70">
        Channel Candidates
        {count > 0 ? (
          <span className="ml-2 font-normal normal-case tracking-normal text-app-ink/60">
            ({count} candidate
            {count === 1 ? "" : "s"})
          </span>
        ) : null}
      </h3>
      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {sortKey === "weighted" ? (
            <DiscoverWeightsEditor
              weights={weights}
              onChange={onWeightsChange}
            />
          ) : null}
          <DiscoverSortChips
            sortKey={sortKey}
            onSortKeyChange={onSortKeyChange}
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * "Following… 3/10" once the selection has cleared. While rows are still
 * selected the bulk bar carries the progress instead.
 */
export function FollowProgressLine({
  isFollowJobRunning,
  followProgress,
  selectedCount,
}: {
  isFollowJobRunning: boolean
  followProgress: FollowJobStatus | null
  selectedCount: number
}) {
  if (!isFollowJobRunning || !followProgress || selectedCount > 0) return null
  return (
    <div
      className="mb-3 text-xs text-app-ink/60"
      data-testid="discover-follow-progress"
    >
      Following… {followProgress.completed}/{followProgress.total}
    </div>
  )
}

/** Loading, no report open, an explained empty result, or the table. */
export function DiscoverReportBody({
  isLoadingReport,
  hasReport,
  candidateCount,
  emptyState,
  onQuickAction,
  table,
}: {
  isLoadingReport: boolean
  hasReport: boolean
  candidateCount: number
  emptyState: DiscoveryEmptyState | null
  onQuickAction: (action: DiscoveryQuickAction) => void
  table: React.ReactNode
}) {
  if (isLoadingReport)
    return (
      <p className="py-12 text-center text-sm text-app-ink/50">
        Loading report…
      </p>
    )
  if (!hasReport)
    return (
      <GoToActionEmptyState
        what="discovery report"
        description="Reports are saved with the scope they were made from, so changing your selection later won't affect them. Open one from History, or generate a new one."
      />
    )
  if (candidateCount === 0 && emptyState)
    return (
      <DiscoverEmptyState state={emptyState} onQuickAction={onQuickAction} />
    )
  return table
}
