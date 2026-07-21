import type { KeyboardEvent, RefObject } from "react"
import { PaletteSubViewHeader } from "@/components/PaletteKeyboardChrome"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  getSearchResultsEmptyMessage,
  getSearchResultsHeaderLabel,
} from "@/lib/commands/palette-messages"
import { truncatePreview } from "@/lib/commands/search-filters"
import type { CommandDef, SearchResultsState } from "@/lib/commands/types"
import type { Post, SummaryListItem } from "@/types"

interface SearchResultsViewProps {
  command: CommandDef
  state: SearchResultsState
  results: Post[] | SummaryListItem[]
  filterQuery: string
  onFilterQueryChange: (value: string) => void
  onInputKeyDown: (event: KeyboardEvent) => void
  selectedId: string
  onSelectedIdChange: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  listRef: RefObject<HTMLDivElement | null>
  onPick: (item: Post | SummaryListItem) => void
  onBack: () => void
}

/** Search-results sub-view: filterable list of matched posts or summaries. */
export function SearchResultsView({
  command,
  state,
  results,
  filterQuery,
  onFilterQueryChange,
  onInputKeyDown,
  selectedId,
  onSelectedIdChange,
  inputRef,
  listRef,
  onPick,
  onBack,
}: SearchResultsViewProps) {
  return (
    <Command
      shouldFilter={false}
      loop
      value={selectedId}
      onValueChange={onSelectedIdChange}
      className="bg-app-card"
      data-testid="command-palette-search-results"
    >
      <PaletteSubViewHeader
        label={getSearchResultsHeaderLabel(command.label, state.query)}
        onBack={onBack}
      />
      <CommandInput
        ref={inputRef}
        placeholder="Filter results..."
        value={filterQuery}
        onValueChange={onFilterQueryChange}
        onKeyDown={onInputKeyDown}
      />
      <CommandList ref={listRef}>
        <CommandEmpty>{getSearchResultsEmptyMessage(state.query)}</CommandEmpty>
        <CommandGroup heading={state.kind === "posts" ? "Posts" : "Summaries"}>
          {state.kind === "posts"
            ? (results as Post[]).map((post) => (
                <CommandItem
                  key={`${post.channelName}_${post.id}`}
                  value={`${post.channelName}_${post.id}`}
                  data-testid={`command-palette-search-result-${post.channelName}_${post.id}`}
                  onSelect={() => onPick(post)}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm">
                      @{post.channelName}
                      <span className="ml-2 text-xs text-app-ink/60">
                        {post.date}
                      </span>
                    </span>
                    <span className="truncate text-xs text-app-ink/60">
                      {truncatePreview(post.text)}
                    </span>
                  </div>
                </CommandItem>
              ))
            : (results as SummaryListItem[]).map((summary) => (
                <CommandItem
                  key={summary.id}
                  value={summary.id}
                  data-testid={`command-palette-search-result-${summary.id}`}
                  onSelect={() => onPick(summary)}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm">
                      {summary.channels.join(", ") || "Summary"}
                    </span>
                    <span className="truncate text-xs text-app-ink/60">
                      {truncatePreview(summary.promptExcerpt || summary.text)}
                    </span>
                  </div>
                </CommandItem>
              ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
