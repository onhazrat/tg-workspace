import type { ArtifactListItem } from "@/types"
import { ArtifactCard } from "./ArtifactCard"
import type { ArtifactActions } from "./ArtifactCardParts"
import { historyDays } from "./history-view-model"

const keyOf = (a: ArtifactListItem) => `${a.kind}:${a.id}`

/**
 * History's cards: one column under day headings while sorted by Written,
 * one ungrouped column under any other sort, or the Compact grid, which has
 * no headings so it fills its rows (most days hold one or two Artifacts).
 */
export function HistoryList({
  rows,
  actions,
  search,
  compact,
  days,
  now,
}: {
  rows: ArtifactListItem[]
  actions: ArtifactActions
  search: string
  compact: boolean
  /** Day headings, which only mean something while sorted by Written. */
  days: boolean
  /** The clock "Today" is read against; the current time by default. */
  now?: number
}) {
  const card = (a: ArtifactListItem) => (
    <ArtifactCard
      key={keyOf(a)}
      artifact={a}
      actions={actions}
      search={search}
      compact={compact}
    />
  )
  if (compact)
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))] gap-3">
        {rows.map(card)}
      </div>
    )
  if (!days)
    return <div className="grid grid-cols-1 gap-3">{rows.map(card)}</div>
  return (
    <div className="space-y-5">
      {historyDays(rows, now).map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h3
            data-testid="history-day"
            className="mb-2 px-1 text-[11px] font-semibold text-app-ink/50"
          >
            {day.label}
          </h3>
          <div className="grid grid-cols-1 gap-3">{day.rows.map(card)}</div>
        </section>
      ))}
    </div>
  )
}
