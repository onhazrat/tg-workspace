import type { KeyboardEvent, RefObject } from "react"
import { PaletteFooterHints } from "@/components/PaletteKeyboardChrome"
import { Badge } from "@/components/ui/badge"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import type { CommandContext, CommandDef } from "@/lib/commands/types"

interface PaletteCommandRowProps {
  command: CommandDef
  context: CommandContext
  onSelect: (command: CommandDef) => void
}

function CommandRowBadge({
  command,
  context,
}: Omit<PaletteCommandRowProps, "onSelect">) {
  const badge = command.getBadge?.(context)
  if (!badge) return null
  const isOnOff = badge === "ON" || badge === "OFF"
  return (
    <Badge
      variant={badge === "ON" ? "default" : "secondary"}
      className={`ml-auto text-[11px] tracking-wider${isOnOff ? " uppercase" : ""}`}
    >
      {badge}
    </Badge>
  )
}

function CommandRowDisabledHint({
  command,
  context,
}: Omit<PaletteCommandRowProps, "onSelect">) {
  const state = command.disabled?.(context)
  if (!state?.disabled || !state.reason) return null
  return (
    <span className="ml-2 text-[11px] text-app-ink/60">{state.reason}</span>
  )
}

function PaletteCommandRow({
  command,
  context,
  onSelect,
}: PaletteCommandRowProps) {
  const disabled = command.disabled?.(context)
  return (
    <CommandItem
      value={command.id}
      disabled={disabled?.disabled}
      onSelect={() => onSelect(command)}
    >
      <span>{command.label}</span>
      <CommandRowDisabledHint command={command} context={context} />
      <CommandRowBadge command={command} context={context} />
    </CommandItem>
  )
}

interface CommandListViewProps {
  query: string
  onQueryChange: (value: string) => void
  onInputKeyDown: (event: KeyboardEvent) => void
  selectedId: string
  onSelectedIdChange: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  listRef: RefObject<HTMLDivElement | null>
  isEmptyQuery: boolean
  displayedRecents: CommandDef[]
  groupedCommands: Map<string, CommandDef[]>
  context: CommandContext
  onSelectCommand: (command: CommandDef) => void
}

/** Root palette view: searchable, grouped command list with recents on top. */
export function CommandListView({
  query,
  onQueryChange,
  onInputKeyDown,
  selectedId,
  onSelectedIdChange,
  inputRef,
  listRef,
  isEmptyQuery,
  displayedRecents,
  groupedCommands,
  context,
  onSelectCommand,
}: CommandListViewProps) {
  return (
    <Command
      shouldFilter={false}
      loop
      value={selectedId}
      onValueChange={onSelectedIdChange}
      className="bg-app-card"
    >
      <CommandInput
        ref={inputRef}
        placeholder="Type a command..."
        value={query}
        onValueChange={onQueryChange}
        onKeyDown={onInputKeyDown}
      />
      <CommandList ref={listRef}>
        <CommandEmpty>No commands found.</CommandEmpty>
        {isEmptyQuery && displayedRecents.length > 0 ? (
          <CommandGroup heading="Recent">
            {displayedRecents.map((command) => (
              <PaletteCommandRow
                key={`recent-${command.id}`}
                command={command}
                context={context}
                onSelect={onSelectCommand}
              />
            ))}
          </CommandGroup>
        ) : null}
        {[...groupedCommands.entries()].map(([group, groupCommandsList]) => (
          <CommandGroup key={group} heading={group}>
            {groupCommandsList.map((command) => (
              <PaletteCommandRow
                key={command.id}
                command={command}
                context={context}
                onSelect={onSelectCommand}
              />
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <PaletteFooterHints hints="↵ run · esc close · ⌫ parent" />
    </Command>
  )
}
