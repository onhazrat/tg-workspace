import type React from "react"
import {
  FacetMenu,
  type FacetMenuRow,
} from "@/components/filter-tree/FacetMenu"
import { getChipSelectionState } from "@/lib/channels/channel-grid-chips"

export type FacetRow = {
  id: string
  label: string
  /** The Channels in the row, which a tick selects. */
  names: string[]
  hint?: string
  /** A derived tag's explanation; such rows are listed under "Derived". */
  explanation?: string
}

/**
 * Groups, Tags and Languages are this one dropdown (CTB-01): a search, then a
 * row per value with a tick that selects every Channel in it, `selected/total`
 * and a funnel that filters the grid to it. The dropdown is the shared
 * `filter-tree/FacetMenu`; this counts each row against the selection.
 */
export function ChannelFacetMenu({
  rows,
  selectedChannels,
  onToggleSelect,
  ...rest
}: {
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
  /** A funnelled id's name, including one the search has hidden. */
  labelOf: (id: string) => string
  onToggleSelect: (row: FacetRow) => void
  onFunnel: (id: string, on: boolean) => void
  onClearFunnels: () => void
  search?: { value: string; onChange: (value: string) => void }
}) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const counted: FacetMenuRow[] = rows.map((row) => {
    const state = getChipSelectionState(row.names, selectedChannels)
    return {
      id: row.id,
      label: row.label,
      hint: row.hint,
      explanation: row.explanation,
      selected: state.selectedCount,
      total: state.totalCount,
      tick: state.isAllSelected ? "true" : state.isPartial ? "mixed" : "false",
    }
  })
  return (
    <FacetMenu
      {...rest}
      rows={counted}
      onToggleSelect={(row) => {
        const own = byId.get(row.id)
        if (own) onToggleSelect(own)
      }}
    />
  )
}
