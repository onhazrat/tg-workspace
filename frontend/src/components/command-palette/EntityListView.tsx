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
import { isNonChannelEntityFlow } from "@/lib/commands/entity-candidates"
import {
  getEntityEmptyMessage,
  getEntityGroupHeading,
  getEntityInputPlaceholder,
} from "@/lib/commands/palette-messages"
import type {
  EntityCandidate,
  ExtendedEntityCandidate,
} from "@/lib/commands/palette-view-model"
import type { CommandDef } from "@/lib/commands/types"
import type { Channel } from "@/types"

interface EntityListViewProps {
  command: CommandDef
  entityQuery: string
  onQueryChange: (value: string) => void
  onInputKeyDown: (event: KeyboardEvent) => void
  selectedId: string
  onSelectedIdChange: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  listRef: RefObject<HTMLDivElement | null>
  candidates: EntityCandidate[]
  onPick: (value: string) => void
  onBack: () => void
}

/** Entity sub-view: pick a channel (or summary/post/tag/table/group) to act on. */
export function EntityListView({
  command,
  entityQuery,
  onQueryChange,
  onInputKeyDown,
  selectedId,
  onSelectedIdChange,
  inputRef,
  listRef,
  candidates,
  onPick,
  onBack,
}: EntityListViewProps) {
  const flow = command.entityFlow ?? "search-channel"
  const isNonChannel = isNonChannelEntityFlow(flow)

  return (
    <Command
      shouldFilter={false}
      loop
      value={selectedId}
      onValueChange={onSelectedIdChange}
      className="bg-app-card"
    >
      <PaletteSubViewHeader label={command.label} onBack={onBack} />
      <CommandInput
        ref={inputRef}
        placeholder={getEntityInputPlaceholder(flow)}
        value={entityQuery}
        onValueChange={onQueryChange}
        onKeyDown={onInputKeyDown}
      />
      <CommandList ref={listRef}>
        <CommandEmpty>
          {getEntityEmptyMessage(flow, Boolean(entityQuery.trim()))}
        </CommandEmpty>
        <CommandGroup heading={getEntityGroupHeading(flow)}>
          {isNonChannel
            ? (candidates as ExtendedEntityCandidate[]).map((item, index) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  data-testid={
                    index === 0
                      ? "command-palette-entity-item-first"
                      : undefined
                  }
                  onSelect={() => onPick(item.id)}
                >
                  <span className="truncate">{item.label}</span>
                </CommandItem>
              ))
            : (candidates as Channel[]).map((channel, index) => (
                <CommandItem
                  key={channel.id}
                  value={channel.name}
                  data-testid={
                    index === 0
                      ? "command-palette-entity-item-first"
                      : undefined
                  }
                  onSelect={() => onPick(channel.name)}
                >
                  <span>@{channel.name}</span>
                  {channel.displayName ? (
                    <span className="text-xs text-app-ink/60">
                      {channel.displayName}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
