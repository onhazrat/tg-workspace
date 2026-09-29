import type React from "react"
import { RelativeTime } from "@/components/RelativeTime"
import type { DiscoverReportView } from "@/lib/posts/discover-report-view"

interface DiscoverReportBarProps {
  view: DiscoverReportView | null
}

/**
 * Identifies the report on screen.
 *
 * A report is an artifact, so the tab must always answer "which one am I
 * looking at, and when was it made?" — otherwise saved and freshly generated
 * results are indistinguishable.
 *
 * It used to also carry a Generate button, which mixed two jobs: *which report
 * am I looking at* and *make another*. The second moved to the Action tab, the
 * one place work starts.
 *
 * It no longer carries a "Close report" button: a report is closed by closing
 * its tab (TABS-01).
 */
export const DiscoverReportBar: React.FC<DiscoverReportBarProps> = ({
  view,
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
    </div>
  </div>
)
