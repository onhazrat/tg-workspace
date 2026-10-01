import { ChevronDown, Filter, Loader2, X } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { BarHeading, BarPopover, BarSearch } from "@/components/BarPopover"
import { pillClass } from "@/components/PostFilterParts"

/** One value in a facet dropdown, with how much of it is selected. */
export type FacetMenuRow = {
  id: string
  label: string
  hint?: string
  /** A derived tag's explanation; such rows are listed under "Derived". */
  explanation?: string
  /** The selected members of the row, and all of them. */
  selected: number
  total: number
  /** The tick: all of the row selected, some, or none. */
  tick: "true" | "mixed" | "false"
  /** The tick is being resolved, as a Posts tick will ask the server. */
  busy?: boolean
}

type FacetMenuProps = {
  icon?: React.ReactNode
  /** The dropdown's name, "Groups". */
  label: string
  /** One row's kind, "group". */
  noun: string
  testId: string
  rows: FacetMenuRow[]
  /** The row ids funnelled into the filter. */
  funnelled: string[]
  /** A funnelled id's name, including one the search has hidden. */
  labelOf: (id: string) => string
  /**
   * A tick that selects every member of the row. Without one the rows have
   * no tick column and the count is the row's `total` alone, as on the Posts
   * tab until its ticks record Selection rules (PTR-06).
   */
  onToggleSelect?: (row: FacetMenuRow) => void
  onFunnel: (id: string, on: boolean) => void
  onClearFunnels: () => void
  /**
   * A search the caller owns and has already narrowed `rows` by, as the tag
   * search does. Without one the dropdown keeps and applies its own.
   */
  search?: { value: string; onChange: (value: string) => void }
  /** The line over the rows; what a tick selects differs by tab. */
  tickHint?: string
  /** Called as the dropdown opens and closes, so a tab can load its counts then. */
  onOpenChange?: (open: boolean) => void
}

function Tick({ row }: { row: FacetMenuRow }) {
  return (
    <span
      aria-hidden
      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border text-[9px] leading-none ${
        row.tick === "true"
          ? "border-app-ink bg-app-ink text-app-bg"
          : row.tick === "mixed"
            ? "border-app-ink/60 bg-app-ink/20"
            : "border-app-ink/30"
      }`}
    >
      {row.busy ? (
        <Loader2 size={9} className="animate-spin" />
      ) : row.tick === "true" ? (
        "✓"
      ) : row.tick === "mixed" ? (
        "–"
      ) : (
        ""
      )}
    </span>
  )
}

function RowLabel({ row }: { row: FacetMenuRow }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-semibold">
        {row.label}
        {row.hint && (
          <span className="ml-1.5 font-normal text-app-ink/40">{row.hint}</span>
        )}
      </span>
      {row.explanation && (
        <span className="block text-[11px] text-app-ink/50">
          {row.explanation}
        </span>
      )}
    </span>
  )
}

/**
 * A facet dropdown (CTB-01): a search, then a row per value with a tick that
 * selects every member of it, `selected/total` and a funnel that filters the
 * list to it. Each tab counts its own rows; Channels' Groups, Tags and
 * Languages are this one component.
 */
export function FacetMenu({
  icon,
  label,
  noun,
  testId,
  rows,
  funnelled,
  labelOf,
  onToggleSelect,
  onFunnel,
  onClearFunnels,
  search,
  tickHint = "Tick selects, the funnel shows only",
  onOpenChange,
}: FacetMenuProps) {
  const ticks = onToggleSelect !== undefined
  const [ownQuery, setOwnQuery] = useState("")
  const query = search ? search.value : ownQuery
  const needle = query.trim().toLowerCase()
  const shown = search
    ? rows
    : rows.filter((row) =>
        `${row.label} ${row.hint ?? ""}`.toLowerCase().includes(needle),
      )
  const withSelection = ticks
    ? rows.filter((row) => row.selected > 0).length
    : 0
  const title =
    funnelled.length > 1
      ? `${funnelled.length} ${label.toLowerCase()}`
      : funnelled.length === 1
        ? labelOf(funnelled[0])
        : label
  const active = funnelled.length > 0

  return (
    <BarPopover
      width="w-80"
      onOpenChange={onOpenChange}
      trigger={
        <button
          type="button"
          data-testid={testId}
          data-active={active}
          className={pillClass(active)}
        >
          {icon}
          <span className="max-w-40 truncate">{title}</span>
          {withSelection > 0 && (
            <span className="rounded-full bg-app-ink/15 px-1.5 text-[10px] tabular-nums">
              {withSelection}
            </span>
          )}
          <ChevronDown size={12} className="opacity-60" />
        </button>
      }
    >
      <BarSearch
        value={query}
        onChange={search ? search.onChange : setOwnQuery}
        placeholder={`Search ${label.toLowerCase()}...`}
      />
      <div className="flex justify-between px-2 pb-1 pt-1 text-[11px] text-app-ink/50">
        <span>{ticks ? tickHint : "The funnel shows only"}</span>
        <span>{ticks ? "selected/total" : "in the window"}</span>
      </div>
      {active && (
        <button
          type="button"
          onClick={onClearFunnels}
          className="mb-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-app-ink/60 hover:bg-app-ink/5 hover:text-app-ink"
        >
          <X size={11} /> Clear {funnelled.length} funnel
          {funnelled.length > 1 ? "s" : ""}
        </button>
      )}
      {shown.length === 0 && (
        <p className="px-2 py-3 text-app-ink/50">
          No {noun} matches {query.trim()}
        </p>
      )}
      {shown.map((row, index) => {
        const on = funnelled.includes(row.id)
        const heading = row.explanation && !shown[index - 1]?.explanation
        return (
          <div key={row.id}>
            {heading && <BarHeading>Derived</BarHeading>}
            <div className="group flex items-center gap-1 rounded-md hover:bg-app-ink/5">
              {ticks ? (
                // biome-ignore lint/a11y/useSemanticElements: a native checkbox cannot say "mixed" without a ref, and a partly selected row must.
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={row.tick}
                  disabled={row.busy}
                  data-testid={`${testId}-row-${row.id}`}
                  onClick={() => onToggleSelect(row)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                >
                  <Tick row={row} />
                  <RowLabel row={row} />
                </button>
              ) : (
                <span
                  data-testid={`${testId}-row-${row.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5"
                >
                  <RowLabel row={row} />
                </span>
              )}
              <span
                data-testid={`${testId}-count-${row.id}`}
                className="font-mono text-[10px] text-app-ink/50"
              >
                {ticks ? `${row.selected}/${row.total}` : row.total}
              </span>
              <button
                type="button"
                aria-pressed={on}
                aria-label={
                  on
                    ? `Stop showing only ${row.label}`
                    : `Show only ${row.label}`
                }
                title={on ? `Stop showing only this ${noun}` : "Show only this"}
                data-testid={`${testId}-funnel-${row.id}`}
                onClick={() => onFunnel(row.id, !on)}
                className={`mr-1 grid h-6 w-6 place-items-center rounded ${
                  on
                    ? "bg-app-ink text-app-bg"
                    : "text-app-ink/40 hover:bg-app-ink/10 hover:text-app-ink"
                }`}
              >
                <Filter size={11} />
              </button>
            </div>
          </div>
        )
      })}
    </BarPopover>
  )
}
