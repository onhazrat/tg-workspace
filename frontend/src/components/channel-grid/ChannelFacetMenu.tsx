import { ChevronDown, Filter, X } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { getChipSelectionState } from "@/lib/channels/channel-grid-chips"
import {
  BarHeading,
  BarPopover,
  BarSearch,
  barTriggerClass,
} from "./BarPopover"

export type FacetRow = {
  id: string
  label: string
  /** The Channels in the row, which a tick selects. */
  names: string[]
  hint?: string
  /** A derived tag's explanation; such rows are listed under "Derived". */
  explanation?: string
}

type ChannelFacetMenuProps = {
  icon?: React.ReactNode
  /** The dropdown's name, "Groups". */
  label: string
  /** One row's kind, "group". */
  noun: string
  testId: string
  rows: FacetRow[]
  selectedChannels: ReadonlySet<string>
  /** The row ids funnelled into the Channel filter. */
  funnelled: string[]
  onToggleSelect: (row: FacetRow) => void
  onFunnel: (id: string, on: boolean) => void
  onClearFunnels: () => void
  /**
   * A search the caller owns and has already narrowed `rows` by, as the tag
   * search does. Without one the dropdown keeps and applies its own.
   */
  search?: { value: string; onChange: (value: string) => void }
}

const tick = (state: { isAllSelected: boolean; isPartial: boolean }) =>
  state.isAllSelected ? "true" : state.isPartial ? "mixed" : "false"

/**
 * Groups, Tags and Languages are this one dropdown (CTB-01): a search, then a
 * row per value with a tick that selects every Channel in it, `selected/total`
 * and a funnel that filters the grid to it.
 */
export function ChannelFacetMenu({
  icon,
  label,
  noun,
  testId,
  rows,
  selectedChannels,
  funnelled,
  onToggleSelect,
  onFunnel,
  onClearFunnels,
  search,
}: ChannelFacetMenuProps) {
  const [ownQuery, setOwnQuery] = useState("")
  const query = search ? search.value : ownQuery
  const needle = query.trim().toLowerCase()
  const shown = search
    ? rows
    : rows.filter((row) =>
        `${row.label} ${row.hint ?? ""}`.toLowerCase().includes(needle),
      )
  const withSelection = rows.filter((row) =>
    row.names.some((name) => selectedChannels.has(name)),
  ).length
  const one = rows.find((row) => row.id === funnelled[0])?.label
  const title =
    funnelled.length > 1
      ? `${funnelled.length} ${label.toLowerCase()}`
      : (one ?? funnelled[0] ?? label)
  const active = funnelled.length > 0

  return (
    <BarPopover
      width="w-80"
      trigger={
        <button
          type="button"
          data-testid={testId}
          data-active={active}
          className={barTriggerClass(active)}
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
        <span>Tick selects, the funnel shows only</span>
        <span>selected/total</span>
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
        const state = getChipSelectionState(row.names, selectedChannels)
        const on = funnelled.includes(row.id)
        const heading = row.explanation && !shown[index - 1]?.explanation
        return (
          <div key={row.id}>
            {heading && <BarHeading>Derived</BarHeading>}
            <div className="group flex items-center gap-1 rounded-md hover:bg-app-ink/5">
              {/* biome-ignore lint/a11y/useSemanticElements: a native checkbox cannot say "mixed" without a ref, and a partly selected row must. */}
              <button
                type="button"
                role="checkbox"
                aria-checked={tick(state)}
                data-testid={`${testId}-row-${row.id}`}
                onClick={() => onToggleSelect(row)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
              >
                <span
                  aria-hidden
                  className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border text-[9px] leading-none ${
                    state.isAllSelected
                      ? "border-app-ink bg-app-ink text-app-bg"
                      : state.isPartial
                        ? "border-app-ink/60 bg-app-ink/20"
                        : "border-app-ink/30"
                  }`}
                >
                  {state.isAllSelected ? "✓" : state.isPartial ? "–" : ""}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {row.label}
                    {row.hint && (
                      <span className="ml-1.5 font-normal text-app-ink/40">
                        {row.hint}
                      </span>
                    )}
                  </span>
                  {row.explanation && (
                    <span className="block text-[11px] text-app-ink/50">
                      {row.explanation}
                    </span>
                  )}
                </span>
              </button>
              <span
                data-testid={`${testId}-count-${row.id}`}
                className="font-mono text-[10px] text-app-ink/50"
              >
                {state.selectedCount}/{state.totalCount}
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
