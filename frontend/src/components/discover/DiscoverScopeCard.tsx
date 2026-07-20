import { Compass } from "lucide-react"
import type React from "react"
import type { DiscoveryScopeCounts } from "@/lib/posts/discover-candidates"
import { FORWARDED_FILTER_LABELS } from "@/lib/posts/discover-empty-state"
import { formatDateToLocalISO } from "@/lib/utils"

interface DiscoverScopeCardProps {
  selectedChannelCount: number
  startDate: number
  endDate: number
  forwardedFilter: string
  postSearch: string
  scopeCounts: DiscoveryScopeCounts
  candidateCount: number
  unfollowedCount: number
  semanticSearchQuery?: string
  maxPostsPerChannel: number
}

export const DiscoverScopeCard: React.FC<DiscoverScopeCardProps> = ({
  selectedChannelCount,
  startDate,
  endDate,
  forwardedFilter,
  postSearch,
  scopeCounts,
  candidateCount,
  unfollowedCount,
  semanticSearchQuery,
  maxPostsPerChannel,
}) => (
  <section className="rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-sm">
    <div className="mb-3 flex items-center gap-2">
      <Compass size={16} className="text-app-ink/60" />
      <h2 className="text-sm font-bold uppercase tracking-widest text-app-ink/70">
        Discovery Scope
      </h2>
    </div>
    <div className="grid gap-2 text-sm text-app-ink/80 sm:grid-cols-2">
      <p>
        <span className="text-app-ink/50">Channels:</span>{" "}
        {selectedChannelCount} selected
      </p>
      <p>
        <span className="text-app-ink/50">Date range:</span>{" "}
        {formatDateToLocalISO(new Date(startDate))} –{" "}
        {formatDateToLocalISO(new Date(endDate))}
      </p>
      <p>
        <span className="text-app-ink/50">Post filter:</span>{" "}
        {FORWARDED_FILTER_LABELS[forwardedFilter] ?? forwardedFilter}
      </p>
      <p>
        <span className="text-app-ink/50">Keyword:</span>{" "}
        {postSearch.trim() ? `"${postSearch.trim()}"` : "None"}
      </p>
      <p data-testid="discover-scope-signal-posts">
        <span className="text-app-ink/50">Posts with signals:</span>{" "}
        {scopeCounts.forwardPosts} fwd · {scopeCounts.mentionPosts} men ·{" "}
        {scopeCounts.linkPosts} link
      </p>
      <p>
        <span className="text-app-ink/50">Candidates:</span> {candidateCount}
        {candidateCount > 0 ? ` (${unfollowedCount} unfollowed)` : null}
      </p>
    </div>
    {semanticSearchQuery?.trim() ? (
      <p className="mt-3 text-xs text-purple-600 dark:text-purple-400">
        Based on semantic search results (up to 50 posts), not your full
        date-range corpus.
      </p>
    ) : null}
    {maxPostsPerChannel > 0 ? (
      <p
        className="mt-2 text-xs text-app-ink/50"
        data-testid="discover-cap-warning"
      >
        Posts are capped at {maxPostsPerChannel} per channel, so these counts
        reflect the capped view rather than your full corpus.
      </p>
    ) : null}
  </section>
)
