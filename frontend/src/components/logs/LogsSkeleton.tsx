import type React from "react"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Placeholder for a log list that is still loading.
 *
 * The tabs previously rendered `logs.length === 0 ? <LogEmptyState/> : …`, which
 * cannot distinguish "still fetching" from "genuinely nothing" — so an open
 * Diagnostics section confidently reported "No LLM logs found" while the request
 * was in flight, then filled in. Saying nothing yet is honest; saying there is
 * nothing is not.
 */
export const LogsSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <output
    aria-busy="true"
    aria-label="Loading logs"
    className="block space-y-3"
  >
    {Array.from({ length: rows }).map((_, index) => (
      <div
        key={`log-skeleton-${index}`}
        className="rounded-lg border border-app-ink/10 bg-app-card p-4"
      >
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-4 rounded bg-app-ink/10" />
          <Skeleton className="h-3 w-40 bg-app-ink/10" />
          <Skeleton className="ml-auto h-3 w-16 bg-app-ink/10" />
        </div>
        <Skeleton className="mt-3 h-3 w-2/3 bg-app-ink/10" />
      </div>
    ))}
  </output>
)
