// PROTOTYPE: the shared bar shell lifted out of DirectoryBar, and History's
// controls inside it (docs/history-tab-redesign-plan.md). Never merge as is.
import { ListFilter, Search } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { SortPicker } from "@/components/filter-tree/SortPicker"
import { ARTIFACT_KIND_LABELS } from "@/components/history/artifact-presentation"
import { pillClass } from "@/components/PostFilterParts"
import { TimeBoundBar } from "@/components/TimeBoundEditor"
import { TgInlineChoice } from "@/components/ui/tg-inline-segments"
import type { TimeBound } from "@/lib/time-bound/bound"
import type { ArtifactKind, ArtifactStatusFilter } from "@/types"
import { WrittenSpread } from "./WrittenSpread"

/** Search on top, a wrapping controls row, a footer; a sheet on a phone. */
export function FilterBar({
  search,
  controls,
  footer,
  phone,
  active,
}: {
  search: React.ReactNode
  controls: React.ReactNode
  footer: React.ReactNode
  phone: boolean
  /** How many controls are off their default, for the phone's button. */
  active: number
}) {
  const [sheet, setSheet] = useState(false)
  return (
    <section className="mb-3 rounded-xl border border-app-ink/10 bg-app-card shadow-md">
      {phone ? (
        <div className="flex items-center gap-2 px-4 pt-4">
          <div className="min-w-0 flex-1">{search}</div>
          <button
            type="button"
            aria-label="Filters and sort"
            onClick={() => setSheet(true)}
            className={`${pillClass(active > 0)} h-9 shrink-0`}
          >
            <ListFilter size={14} />
            {active > 0 ? active : "Filters"}
          </button>
        </div>
      ) : (
        <div className="px-4 pt-4">{search}</div>
      )}
      {!phone && (
        <div className="flex flex-wrap items-center gap-2 p-4">{controls}</div>
      )}
      {phone && sheet && (
        <div
          role="dialog"
          aria-label="Filters and sort"
          className="fixed inset-0 z-40 flex flex-wrap content-start items-center gap-2.5 overflow-y-auto bg-app-bg p-4 pb-24"
        >
          <div className="mb-1 flex w-full items-center justify-between">
            <b className="text-sm">Filters and sort</b>
            <button
              type="button"
              onClick={() => setSheet(false)}
              className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white"
            >
              Done
            </button>
          </div>
          {controls}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-app-ink/5 bg-app-muted/30 px-4 py-2.5 text-xs">
        {footer}
      </div>
    </section>
  )
}

export type HistorySort = "written" | "window"
export type HistoryMoment = "written" | "window"

/** Each Kind and Status counted under every other filter (prototype API). */
export type HistoryCounts = {
  total: number
  kinds: Record<ArtifactKind, number>
  kindsAll: number
  statuses: Record<ArtifactStatusFilter, number>
  statusesAll: number
}

const Count = ({ n }: { n: number | undefined }) =>
  n === undefined ? null : (
    <span className="ml-1 tabular-nums opacity-50">{n.toLocaleString()}</span>
  )

export type HistoryBarState = {
  search: string
  kind: ArtifactKind | null
  status: ArtifactStatusFilter | null
  starred: boolean
  written: TimeBound
  /** What the time filter bounds: Written, or overlap with the Analysis window. */
  moment: HistoryMoment
  sort: HistorySort
  descending: boolean
}

const KINDS: (ArtifactKind | "all")[] = [
  "all",
  "summary",
  "chat",
  "tag",
  "discovery",
]

export function HistoryBar({
  state,
  onChange,
  phone,
  footer,
  trailing,
  counts,
}: {
  state: HistoryBarState
  counts?: HistoryCounts
  onChange: (patch: Partial<HistoryBarState>) => void
  phone: boolean
  footer: React.ReactNode
  /** Switches at the end of the controls row: the Compact grid. */
  trailing?: React.ReactNode
}) {
  const active =
    Number(state.kind !== null) +
    Number(state.status !== null) +
    Number(state.starred) +
    Number(state.written.start !== undefined || state.written.end !== undefined)
  return (
    <FilterBar
      phone={phone}
      active={active}
      footer={footer}
      search={
        <div className="flex items-center gap-2 rounded-xl border border-app-ink/10 bg-app-muted pl-3 pr-1.5 transition-colors focus-within:border-app-ink/30">
          <Search size={16} className="text-app-ink/50" />
          <input
            type="search"
            dir="auto"
            aria-label="Search history"
            value={state.search}
            placeholder="Search channels, titles and notes"
            onChange={(e) => onChange({ search: e.target.value })}
            className="min-w-0 flex-1 bg-transparent py-3 text-sm focus:outline-none"
          />
        </div>
      }
      controls={
        <>
          <TgInlineChoice
            aria-label="Artifact kind"
            options={KINDS.map((k) => ({
              value: k,
              label: (
                <>
                  {k === "all" ? "All kinds" : ARTIFACT_KIND_LABELS[k]}
                  <Count
                    n={k === "all" ? counts?.kindsAll : counts?.kinds[k]}
                  />
                </>
              ),
            }))}
            value={state.kind ?? "all"}
            onChange={(k) => onChange({ kind: k === "all" ? null : k })}
          />
          <TgInlineChoice
            aria-label="Artifact status"
            options={[
              {
                value: "all",
                label: (
                  <>
                    Any status
                    <Count n={counts?.statusesAll} />
                  </>
                ),
              },
              {
                value: "failed",
                label: (
                  <>
                    Failed
                    <Count n={counts?.statuses.failed} />
                  </>
                ),
              },
              {
                value: "pending",
                label: (
                  <>
                    Pending
                    <Count n={counts?.statuses.pending} />
                  </>
                ),
              },
            ]}
            value={state.status ?? "all"}
            onChange={(s) =>
              onChange({
                status: s === "all" ? null : (s as ArtifactStatusFilter),
              })
            }
          />
          <BarToggle
            on={state.starred}
            label="Starred"
            title="Only starred artifacts"
            onClick={() => onChange({ starred: !state.starred })}
          />
          <span className="mx-1 h-5 w-px bg-app-ink/10" />
          <div className="flex items-center gap-1.5">
            <TgInlineChoice
              aria-label="Time filter on"
              options={[
                { value: "written" as const, label: "Written" },
                { value: "window" as const, label: "Window" },
              ]}
              value={state.moment}
              onChange={(moment) => onChange({ moment })}
            />
            <TimeBoundBar
              label={state.moment === "written" ? "Written" : "Window"}
              value={state.written}
              onChange={(written) => onChange({ written })}
              opts={{ openEnds: true }}
            >
              <WrittenSpread
                state={state}
                onPick={(written) => onChange({ written })}
              />
            </TimeBoundBar>
          </div>
          <SortPicker
            options={[
              { value: "written" as const, label: "Written" },
              { value: "window" as const, label: "Window start" },
            ]}
            value={state.sort}
            onChange={(sort) => onChange({ sort })}
            direction={state.descending ? "desc" : "asc"}
            onToggleDirection={() =>
              onChange({ descending: !state.descending })
            }
            testId="history-sort"
          />
          {trailing}
        </>
      }
    />
  )
}
