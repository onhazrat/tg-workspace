import { EyeOff, Plus, RefreshCw, Undo2 } from "lucide-react"
import type React from "react"
import type { FollowJobStatus } from "@/api"
import { TgButton } from "@/components/ui/tg-button"

interface DiscoverBulkBarProps {
  selectedCount: number
  isOffline: boolean
  isFollowJobRunning: boolean
  followProgress: FollowJobStatus | null
  onFollowSelected: () => void
  onClearSelection: () => void
  /**
   * Dismiss the selection, or restore it while viewing "Ignored".
   *
   * One action rather than two buttons: in the Ignored view every visible row
   * is already dismissed, so a "Dismiss selected" there would be a no-op.
   */
  onDismissSelected: () => void
  dismissMode: "dismiss" | "restore"
  isDismissPending: boolean
  /**
   * Re-probe the selection, discarding cached verdicts.
   *
   * Only offered in the "Not followable" view: everywhere else the visible rows
   * have no verdict to overturn, so a bulk recheck would just be an expensive
   * no-op over handles the sweep already resolved.
   */
  onRecheckSelected: () => void
  showRecheck: boolean
  isRecheckPending: boolean
}

export const DiscoverBulkBar: React.FC<DiscoverBulkBarProps> = ({
  selectedCount,
  isOffline,
  isFollowJobRunning,
  followProgress,
  onFollowSelected,
  onClearSelection,
  onDismissSelected,
  dismissMode,
  isDismissPending,
  onRecheckSelected,
  showRecheck,
  isRecheckPending,
}) => (
  <div
    className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"
    data-testid="discover-bulk-bar"
  >
    <span className="text-xs font-bold uppercase tracking-wider text-app-ink/70">
      {selectedCount} selected
    </span>
    {/* Following something already dismissed is contradictory, so in the
     * Ignored view the only bulk action offered is Restore. */}
    {dismissMode === "dismiss" ? (
      <TgButton
        type="button"
        variant="secondary"
        size="sm"
        data-testid="discover-follow-selected"
        disabled={isOffline}
        loading={isFollowJobRunning}
        loadingLabel="Follow selected"
        onClick={onFollowSelected}
        className="rounded-full border-blue-500/30 text-blue-600 hover:bg-blue-500/10 dark:text-blue-400"
      >
        <Plus size={12} />
        Follow selected
      </TgButton>
    ) : null}
    {/*
     * No confirmation, unlike bulk follow: following scrapes and creates
     * channels, while dismissing only sets a flag and is undone by this same
     * button in the Ignored view.
     */}
    <TgButton
      type="button"
      variant="secondary"
      size="sm"
      data-testid="discover-dismiss-selected"
      disabled={isOffline || isFollowJobRunning}
      loading={isDismissPending}
      loadingLabel={
        dismissMode === "dismiss" ? "Dismiss selected" : "Restore selected"
      }
      onClick={onDismissSelected}
      className="rounded-full text-app-ink/70"
    >
      {dismissMode === "dismiss" ? (
        <>
          <EyeOff size={12} />
          Dismiss selected
        </>
      ) : (
        <>
          <Undo2 size={12} />
          Restore selected
        </>
      )}
    </TgButton>
    {showRecheck ? (
      <TgButton
        type="button"
        variant="secondary"
        size="sm"
        data-testid="discover-recheck-selected"
        disabled={isOffline}
        loading={isRecheckPending}
        loadingLabel="Recheck selected"
        onClick={onRecheckSelected}
        className="rounded-full text-app-ink/70"
      >
        <RefreshCw size={12} />
        Recheck selected
      </TgButton>
    ) : null}
    <TgButton
      type="button"
      variant="secondary"
      size="sm"
      data-testid="discover-clear-selection"
      disabled={isFollowJobRunning}
      onClick={onClearSelection}
      className="rounded-full text-app-ink/60"
    >
      Clear
    </TgButton>
    {isFollowJobRunning && followProgress ? (
      <span
        className="text-xs text-app-ink/60"
        data-testid="discover-follow-progress"
      >
        Following… {followProgress.completed}/{followProgress.total}
      </span>
    ) : null}
  </div>
)
