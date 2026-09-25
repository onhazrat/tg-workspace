/**
 * The decisions `CommandPalette` makes about keys, going back and which panel
 * shows. The component keeps the hooks and wires these to them.
 */
import { getChainedEditorField } from "@/lib/commands/extended-commands"
import {
  type EntityCandidate,
  resolveEntityPickId,
} from "@/lib/commands/palette-view-model"
import type {
  CommandContext,
  CommandDef,
  PaletteMode,
  SearchResultsState,
} from "@/lib/commands/types"
import type { Channel } from "@/types"

interface KeyState {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

/** Backspace in an empty sub-view search goes back one level. */
export function isBackspaceBack(
  key: string,
  searchValue: string,
  stackDepth: number,
): boolean {
  return key === "Backspace" && searchValue.trim() === "" && stackDepth > 1
}

/** Enter applies the editor; a textarea needs Cmd/Ctrl so Enter can add a line. */
export function editorEnterApplies(
  event: Pick<KeyState, "key" | "metaKey" | "ctrlKey">,
  isTextarea: boolean,
  isApplying: boolean,
): boolean {
  if (isApplying || event.key !== "Enter") return false
  return !isTextarea || event.metaKey || event.ctrlKey
}

/**
 * The command Enter runs from the root list: the selected one, else the top
 * ranked. Shift+Enter without Cmd/Ctrl runs nothing.
 */
export function commandEnterTarget(
  event: KeyState,
  commands: CommandDef[],
  rankedCommands: CommandDef[],
  selectedId: string,
): CommandDef | undefined {
  if (event.key !== "Enter") return undefined
  if (event.shiftKey && !event.metaKey && !event.ctrlKey) return undefined
  return (
    commands.find((entry) => entry.id === selectedId) ??
    rankedCommands.find((entry) => entry.id === selectedId) ??
    rankedCommands[0]
  )
}

/** The entity Enter picks, or "" when Enter picks nothing. */
export function entityEnterPickId(
  key: string,
  entityCommand: CommandDef | null,
  entity: {
    entityQuery: string
    candidates: EntityCandidate[]
    selectedId: string
  },
): string {
  const flow = entityCommand?.entityFlow
  if (key !== "Enter" || !flow) return ""
  return resolveEntityPickId({
    flow,
    entityQuery: entity.entityQuery,
    candidates: entity.candidates,
    selectedEntityId: entity.selectedId,
  })
}

export type SelectAction =
  | "disabled"
  | "editor"
  | "entity"
  | "assistant"
  | "confirm"
  | "run"

/** What choosing a command from the root list does. */
export function selectCommandAction(
  command: CommandDef,
  context: CommandContext,
): SelectAction {
  if (command.disabled?.(context).disabled) return "disabled"
  if (command.kind === "editor") return "editor"
  if (command.kind === "entity-root" && command.entityFlow) return "entity"
  if (command.kind === "assistant") return "assistant"
  if (command.requiresConfirmation) return "confirm"
  return "run"
}

/**
 * Leaving an entity list that stays open after a pick counts as using its
 * command, so it is recorded then. Returns that command, or null.
 */
export function pickRecordedOnBack(
  leaving: PaletteMode,
  entityCommand: CommandDef | null,
): CommandDef | null {
  if (leaving !== "entity" || entityCommand?.closeOnPick !== false) return null
  return entityCommand
}

/** A confirm raised from an entity list that stays open returns to it. */
export function confirmStaysInEntity(
  command: CommandDef,
  entityCommand: CommandDef | null,
): boolean {
  return entityCommand?.closeOnPick === false && command.id === entityCommand.id
}

/** The palette's close button leaves the tab order in list modes. */
export function closeButtonTabIndex(mode: PaletteMode): -1 | undefined {
  const isListMode =
    mode === "commands" || mode === "entity" || mode === "search-results"
  return isListMode ? -1 : undefined
}

export type PalettePanel =
  | { kind: "confirm"; command: CommandDef }
  | { kind: "assistant" }
  | { kind: "editor"; command: CommandDef; fieldLabel: string | undefined }
  | { kind: "entity"; command: CommandDef }
  | {
      kind: "search-results"
      command: CommandDef
      state: SearchResultsState
    }
  | { kind: "commands" }

export interface PalettePanelInput {
  mode: PaletteMode
  pendingCommand: CommandDef | null
  editorCommand: CommandDef | null
  entityCommand: CommandDef | null
  entityPayload: unknown
  searchResultsState: SearchResultsState | null
  searchResultsCommand: CommandDef | null
}

function editorPanel(
  command: CommandDef | null,
  entityPayload: unknown,
): PalettePanel | null {
  if (!command) return null
  const chained = getChainedEditorField(
    command.id,
    entityPayload as Channel | undefined,
  )
  const field = command.editorField
  if (!field && !chained) return null
  return {
    kind: "editor",
    command,
    fieldLabel: chained?.label ?? field?.label,
  }
}

function searchResultsPanel(
  command: CommandDef | null,
  state: SearchResultsState | null,
): PalettePanel | null {
  return command && state ? { kind: "search-results", command, state } : null
}

/** The one panel the palette shows for its mode, or null while it has none. */
export function activePalettePanel(
  input: PalettePanelInput,
): PalettePanel | null {
  const byMode: Record<PaletteMode, () => PalettePanel | null> = {
    confirm: () =>
      input.pendingCommand
        ? { kind: "confirm", command: input.pendingCommand }
        : null,
    assistant: () => ({ kind: "assistant" }),
    editor: () => editorPanel(input.editorCommand, input.entityPayload),
    entity: () =>
      input.entityCommand
        ? { kind: "entity", command: input.entityCommand }
        : null,
    "search-results": () =>
      searchResultsPanel(input.searchResultsCommand, input.searchResultsState),
    commands: () => ({ kind: "commands" }),
  }
  return byMode[input.mode]()
}
