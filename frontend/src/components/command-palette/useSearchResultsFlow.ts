import { useMemo, useRef, useState } from "react"
import { usePaletteListSelection } from "@/hooks/usePaletteListSelection"
import {
  filterSearchResultItems,
  getFirstSearchResultId,
} from "@/lib/commands/palette-view-model"
import {
  pickSearchPost,
  pickSearchSummary,
} from "@/lib/commands/search-filters"
import type {
  CommandContext,
  CommandDef,
  SearchResultsState,
} from "@/lib/commands/types"
import type { Post, SummaryListItem } from "@/types"

interface UseSearchResultsFlowOptions {
  open: boolean
  isActive: boolean
  searchResultsState: SearchResultsState | null
  searchResultsCommand: CommandDef | null
  context: CommandContext
  getRootQuery: () => string
  recordPick: (query: string, commandId: string) => void
  recordRecent: (commandId: string) => void
  close: () => void
}

/** State and behavior for the search-results sub-view. */
export function useSearchResultsFlow({
  open,
  isActive,
  searchResultsState,
  searchResultsCommand,
  context,
  getRootQuery,
  recordPick,
  recordRecent,
  close,
}: UseSearchResultsFlowOptions) {
  const [filterQuery, setFilterQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredResults = useMemo(
    () => filterSearchResultItems(searchResultsState, filterQuery),
    [filterQuery, searchResultsState],
  )

  const firstResultId = useMemo(
    () => getFirstSearchResultId(filteredResults, searchResultsState?.kind),
    [filteredResults, searchResultsState?.kind],
  )

  const { selectedId, setSelectedId } = usePaletteListSelection({
    isActive,
    open,
    firstNavigableId: firstResultId,
    filterKey: `${filterQuery}:${searchResultsState?.items.length ?? 0}`,
    listRef,
  })

  const handlePick = (item: Post | SummaryListItem) => {
    if (!searchResultsCommand || !searchResultsState) return

    if (searchResultsState.kind === "posts") {
      pickSearchPost(context, item as Post)
    } else {
      pickSearchSummary(context, item as SummaryListItem)
    }

    const rootQuery = getRootQuery()
    if (rootQuery.trim()) {
      recordPick(rootQuery, searchResultsCommand.id)
    }
    recordRecent(searchResultsCommand.id)
    close()
  }

  return {
    filterQuery,
    setFilterQuery,
    inputRef,
    viewProps: {
      results: filteredResults,
      filterQuery,
      onFilterQueryChange: setFilterQuery,
      selectedId,
      onSelectedIdChange: setSelectedId,
      inputRef,
      listRef,
      onPick: handlePick,
    },
  }
}
