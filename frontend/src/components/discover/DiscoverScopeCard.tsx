import { Compass } from "lucide-react"
import type React from "react"
import { formatDateRange } from "@/lib/format-date-range"
import { countOf } from "@/lib/plural"
import { FORWARDED_FILTER_LABELS } from "@/lib/posts/discover-empty-state"
import type { DiscoverReportView } from "@/lib/posts/discover-report-view"

interface DiscoverScopeCardProps {
  /** The report on screen; `null` before one has ever been generated. */
  view: DiscoverReportView | null
  /** Live channel selection, shown only in the no-report-yet state. */
  liveChannelCount: number
  candidateCount: number
  unfollowedCount: number
}

/**
 * The scope the visible numbers came from.
 *
 * Deliberately reads from the *report*, not from live selection state. A saved
 * report is immutable, so once the user changes their selection the live scope
 * no longer describes it — rendering live values here was the original bug
 * (IDEA-011 W1).
 */
export const DiscoverScopeCard: React.FC<DiscoverScopeCardProps> = ({
  view,
  liveChannelCount,
  candidateCount,
  unfollowedCount,
}) => (
  <section className="rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-sm">
    <div className="mb-3 flex items-center gap-2">
      <Compass size={16} className="text-app-ink/60" />
      <h2 className="text-sm font-bold uppercase tracking-widest text-app-ink/70">
        {view ? "Report Scope" : "Discovery Scope"}
      </h2>
    </div>

    {view === null ? (
      <p className="text-sm text-app-ink/60">
        {liveChannelCount} channel{liveChannelCount === 1 ? "" : "s"} selected.
        Generate a report to discover channels they reference.
      </p>
    ) : (
      <>
        <div className="grid gap-2 text-sm text-app-ink/80 sm:grid-cols-2">
          <p>
            <span className="text-app-ink/50">Channels:</span>{" "}
            {view.scope.channels.length} selected
          </p>
          <p>
            <span className="text-app-ink/50">Date range:</span>{" "}
            {formatDateRange(
              new Date(view.scope.startDate),
              new Date(view.scope.endDate),
            )}
          </p>
          <p>
            <span className="text-app-ink/50">Post filter:</span>{" "}
            {FORWARDED_FILTER_LABELS[view.scope.forwarded] ??
              view.scope.forwarded}
          </p>
          <p>
            <span className="text-app-ink/50">Keyword:</span>{" "}
            {view.scope.keyword?.trim()
              ? `"${view.scope.keyword.trim()}"`
              : "None"}
          </p>
          <p data-testid="discover-scope-signal-posts">
            <span className="text-app-ink/50">Posts with signals:</span>{" "}
            {countOf(view.scopeCounts.forwardPosts, "forward")} ·{" "}
            {countOf(view.scopeCounts.mentionPosts, "mention")} ·{" "}
            {countOf(view.scopeCounts.linkPosts, "link")}
          </p>
          <p>
            <span className="text-app-ink/50">Candidates:</span>{" "}
            {candidateCount}
            {candidateCount > 0 ? ` (${unfollowedCount} unfollowed)` : null}
          </p>
        </div>

        {view.scope.maxPerChannel > 0 ? (
          <p
            className="mt-2 text-xs text-app-ink/50"
            data-testid="discover-cap-warning"
          >
            Posts were capped at {view.scope.maxPerChannel} per channel, so
            these counts reflect the capped view rather than your full corpus.
          </p>
        ) : null}
      </>
    )}
  </section>
)
