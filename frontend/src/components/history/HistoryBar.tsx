/**
 * History's bar, on the shared `FilterBar`: the search; Kind and Status as
 * quiet segments, each choice saying how many Artifacts it would show; Starred;
 * the time filter on Written or the Analysis window, its spread in its
 * popover; the sort. The footer gives the true total, the sort in words and
 * the Compact grid switch. Props only; `HistoryView` wires it.
 */
import { LayoutGrid, Search } from "lucide-react"
import type React from "react"
import type { ArtifactCountsResponse } from "@/client"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { FilterBar } from "@/components/FilterBar"
import { SortPicker } from "@/components/filter-tree/SortPicker"
import { pillClass } from "@/components/PostFilterParts"
import { TimeBoundBar } from "@/components/TimeBoundEditor"
import { TgInlineChoice } from "@/components/ui/tg-inline-segments"
import type {
  HistoryMoment,
  HistoryParams,
  HistorySort,
} from "@/lib/history/history-params"
import type { ArtifactKind, ArtifactStatusFilter } from "@/types"
import { ARTIFACT_KIND_LABELS } from "./artifact-presentation"
import { historyActiveFilters, historySortWords } from "./history-view-model"

const KINDS: (ArtifactKind | "all")[] = [
  "all",
  "summary",
  "chat",
  "tag",
  "discovery",
]
const STATUSES: (ArtifactStatusFilter | "all")[] = ["all", "failed", "pending"]
const STATUS_LABELS = {
  all: "Any status",
  failed: "Failed",
  pending: "Pending",
}

/** A choice and its count; a choice that would show nothing is dimmed. */
function Counted({ label, n }: { label: string; n: number | undefined }) {
  return (
    <span
      data-empty={n === 0 || undefined}
      className={n === 0 ? "opacity-40" : undefined}
    >
      {label}
      {n !== undefined && (
        <span className="ml-1 tabular-nums opacity-60">
          {n.toLocaleString()}
        </span>
      )}
    </span>
  )
}

export type HistoryBarProps = {
  params: HistoryParams
  onChange: (patch: Partial<HistoryParams>) => void
  /** While loading, the choices show no counts and the total "…". */
  counts?: ArtifactCountsResponse
  /** The time filter's spread, mounted in its popover while open. */
  spread?: React.ReactNode
  compact: boolean
  onCompact: (on: boolean) => void
  phone?: boolean
}

export function HistoryBar({
  params: p,
  onChange,
  counts,
  spread,
  compact,
  onCompact,
  phone,
}: HistoryBarProps) {
  const timeLabel = p.moment === "written" ? "Written" : "Window"
  return (
    <FilterBar
      phone={phone}
      active={historyActiveFilters(p)}
      testIdPrefix="history"
      search={
        <div className="flex items-center gap-2 rounded-xl border border-app-ink/10 bg-app-muted pl-3 pr-1.5 transition-colors focus-within:border-app-ink/30">
          <Search size={16} className="text-app-ink/50" />
          <input
            type="search"
            dir="auto"
            aria-label="Search history"
            value={p.search}
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
              "data-testid": `history-kind-${k}`,
              label: (
                <Counted
                  label={k === "all" ? "All kinds" : ARTIFACT_KIND_LABELS[k]}
                  n={k === "all" ? counts?.kindsAll : counts?.kinds[k]}
                />
              ),
            }))}
            value={p.kind ?? "all"}
            onChange={(k) => onChange({ kind: k === "all" ? null : k })}
          />
          <TgInlineChoice
            aria-label="Artifact status"
            options={STATUSES.map((s) => ({
              value: s,
              "data-testid": `history-status-${s}`,
              label: (
                <Counted
                  label={STATUS_LABELS[s]}
                  n={s === "all" ? counts?.statusesAll : counts?.statuses[s]}
                />
              ),
            }))}
            value={p.status ?? "all"}
            onChange={(s) => onChange({ status: s === "all" ? null : s })}
          />
          <BarToggle
            on={p.starred}
            label="Starred"
            title="Only starred artifacts"
            testId="history-starred"
            onClick={() => onChange({ starred: !p.starred })}
          />
          <span className="mx-1 h-5 w-px bg-app-ink/10" />
          <div className="flex items-center gap-1.5">
            <TgInlineChoice<HistoryMoment>
              aria-label="Time filter on"
              options={[
                {
                  value: "written",
                  label: "Written",
                  "data-testid": "history-moment-written",
                },
                {
                  value: "window",
                  label: "Window",
                  "data-testid": "history-moment-window",
                },
              ]}
              value={p.moment}
              onChange={(moment) => onChange({ moment })}
            />
            <TimeBoundBar
              label={timeLabel}
              value={p.bound}
              onChange={(bound) => onChange({ bound })}
              opts={{ openEnds: true }}
            >
              {spread}
            </TimeBoundBar>
          </div>
          <SortPicker<HistorySort>
            options={[
              { value: "written", label: "Written" },
              { value: "window", label: "Window start" },
            ]}
            value={p.sort}
            onChange={(sort) => onChange({ sort })}
            direction={p.descending ? "desc" : "asc"}
            onToggleDirection={() => onChange({ descending: !p.descending })}
            testId="history-sort"
          />
        </>
      }
      footer={
        <>
          <span data-testid="history-total" className="font-semibold">
            {counts
              ? `${counts.total.toLocaleString()} artifact${counts.total === 1 ? "" : "s"}`
              : "… artifacts"}
          </span>
          <span className="text-app-ink/50">
            {historySortWords(p.sort, p.descending)}
          </span>
          <button
            type="button"
            aria-pressed={compact}
            data-testid="history-compact-grid"
            onClick={() => onCompact(!compact)}
            className={`${pillClass(compact)} ml-auto`}
          >
            <LayoutGrid size={12} /> Compact grid
          </button>
        </>
      }
    />
  )
}
