import { Plus } from "lucide-react"
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
}

export const DiscoverBulkBar: React.FC<DiscoverBulkBarProps> = ({
  selectedCount,
  isOffline,
  isFollowJobRunning,
  followProgress,
  onFollowSelected,
  onClearSelection,
}) => (
  <div
    className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"
    data-testid="discover-bulk-bar"
  >
    <span className="text-xs font-bold uppercase tracking-wider text-app-ink/70">
      {selectedCount} selected
    </span>
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
