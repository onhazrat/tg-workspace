import { ChevronDown, ChevronRight, Compass, Trash2 } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { RelativeTime } from "@/components/RelativeTime"
import { TgButton } from "@/components/ui/tg-button"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import {
  useDeleteDiscoverReportMutation,
  useDiscoverReportsQuery,
} from "@/hooks/useDiscover"
import { formatDateRange } from "@/lib/format-date-range"

interface DiscoverReportsHistoryProps {
  /** Open a saved report on the Discover tab. */
  onOpenReport: (reportId: string) => void
}

/**
 * Saved Discover reports, listed alongside summaries.
 *
 * A report is an artifact with the same lifecycle as a summary (IDEA-011 W1),
 * so History is where it is archived, kept until explicitly deleted. Rows come
 * from the light projection — the candidate rows themselves are only fetched
 * when a report is opened.
 */
export const DiscoverReportsHistory: React.FC<DiscoverReportsHistoryProps> = ({
  onOpenReport,
}) => {
  const [expanded, setExpanded] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const reportsQuery = useDiscoverReportsQuery()
  const deleteReport = useDeleteDiscoverReportMutation()

  const reports = reportsQuery.data ?? []

  return (
    <section
      className="mb-6 rounded-xl border border-app-ink/10 bg-app-card shadow-sm"
      data-testid="discover-reports-history"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 p-4 text-left"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Compass size={16} className="text-app-ink/60" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-app-ink/70">
          Discovery Reports
        </h3>
        <span className="text-xs text-app-ink/50">
          {reportsQuery.isLoading ? "…" : reports.length}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-app-ink/10 p-4">
          {reportsQuery.isLoading ? (
            <p className="text-sm text-app-ink/50">Loading reports…</p>
          ) : reports.length === 0 ? (
            <p className="text-sm text-app-ink/50">
              No saved reports yet. Generate one from the Discover tab.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {reports.map((report) => (
                <li
                  key={report.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-app-ink/10 p-3"
                  data-testid={`discover-report-row-${report.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {report.candidateCount} candidate
                      {report.candidateCount === 1 ? "" : "s"}
                      <span className="ml-2 font-normal text-app-ink/60">
                        from {report.scope.channels.length} channel
                        {report.scope.channels.length === 1 ? "" : "s"}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-app-ink/50">
                      <RelativeTime timestamp={report.timestamp} />
                      {" · "}
                      {formatDateRange(
                        new Date(report.scope.startDate),
                        new Date(report.scope.endDate),
                      )}
                      {report.scope.keyword?.trim()
                        ? ` · "${report.scope.keyword.trim()}"`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <TgButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => onOpenReport(report.id)}
                      data-testid={`discover-report-open-${report.id}`}
                      className="rounded-full"
                    >
                      Open
                    </TgButton>
                    <TgButton
                      type="button"
                      variant="dangerSoft"
                      size="sm"
                      onClick={() => setPendingDelete(report.id)}
                      data-testid={`discover-report-delete-${report.id}`}
                      className="rounded-full"
                    >
                      <Trash2 size={12} />
                    </TgButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <TgConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Delete report?"
        description="This permanently removes the saved report. The channels it found are not affected."
        confirmLabel="Delete"
        onConfirm={() => {
          const id = pendingDelete
          setPendingDelete(null)
          if (id) deleteReport.mutate(id)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}
