import type { DiscoverReport, DiscoverReportScope } from "@/api/data"
import type {
  DiscoveryCandidate,
  DiscoveryScopeCounts,
  DiscoverySignalKind,
} from "./discover-candidates"

/**
 * What the Discover tab renders.
 *
 * Every report is saved (IDEA-011 W1) and every scope is aggregated
 * server-side (D14), so this is a thin projection of the stored row rather
 * than a union of "saved" and "computed here" shapes.
 */
export interface DiscoverReportView {
  id: string
  scope: DiscoverReportScope
  scopeCounts: DiscoveryScopeCounts
  postsInScope: number
  candidates: DiscoveryCandidate[]
  /** Generation time (ms). */
  timestamp: number
}

export function savedReportToView(report: DiscoverReport): DiscoverReportView {
  return {
    id: report.id,
    scope: report.scope,
    scopeCounts: report.scopeCounts,
    postsInScope: report.postsInScope,
    candidates: report.candidates,
    timestamp: report.timestamp,
  }
}

/**
 * The signal kinds a report was generated with.
 *
 * Read from the report rather than from live settings: the chips configure the
 * *next* run, so after changing them they no longer describe the report on
 * screen. An empty stored list means "all kinds", matching the server's
 * `signals=None` default.
 */
export function reportSignalKinds(
  view: DiscoverReportView,
  allKinds: readonly DiscoverySignalKind[],
): Set<DiscoverySignalKind> {
  const stored = view.scope.signals
  if (!stored || stored.length === 0) return new Set(allKinds)
  return new Set(
    stored.filter((s): s is DiscoverySignalKind =>
      (allKinds as readonly string[]).includes(s),
    ),
  )
}
