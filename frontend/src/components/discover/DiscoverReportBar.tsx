import { History, Sparkles } from "lucide-react"
import type React from "react"
import { RelativeTime } from "@/components/RelativeTime"
import { TgButton } from "@/components/ui/tg-button"
import type { DiscoverReportView } from "@/lib/posts/discover-report-view"

interface DiscoverReportBarProps {
  view: DiscoverReportView | null
  /** True while an older report is pinned via `?report=`. */
  isPinned: boolean
  isGenerating: boolean
  isOffline: boolean
  onGenerate: () => void
  onShowLatest: () => void
}

/**
 * Identifies the report on screen and offers to generate another.
 *
 * A report is an artifact, so the tab must always answer "which one am I
 * looking at, and when was it made?" — otherwise saved and freshly generated
 * results are indistinguishable.
 */
export const DiscoverReportBar: React.FC<DiscoverReportBarProps> = ({
  view,
  isPinned,
  isGenerating,
  isOffline,
  onGenerate,
  onShowLatest,
}) => (
  <div
    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-ink/10 bg-app-card p-3 shadow-sm"
    data-testid="discover-report-bar"
  >
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {view === null ? (
        <span className="text-app-ink/60">No report yet</span>
      ) : (
        <span className="text-app-ink/70" data-testid="discover-report-meta">
          Report from <RelativeTime timestamp={view.timestamp ?? 0} />
          <span className="ml-2 text-xs text-app-ink/50">
            {view.candidates.length} candidate
            {view.candidates.length === 1 ? "" : "s"}
          </span>
        </span>
      )}
      {isPinned ? (
        <TgButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={onShowLatest}
          data-testid="discover-show-latest"
          className="rounded-full"
        >
          <History size={12} />
          Show latest
        </TgButton>
      ) : null}
    </div>

    <TgButton
      variant="primary"
      size="sm"
      onClick={onGenerate}
      disabled={isOffline || isGenerating}
      loading={isGenerating}
      loadingLabel="Generating…"
      data-testid="discover-generate-button"
    >
      <Sparkles size={14} />
      {view === null ? "Generate Discovery Report" : "Generate new report"}
    </TgButton>
  </div>
)
