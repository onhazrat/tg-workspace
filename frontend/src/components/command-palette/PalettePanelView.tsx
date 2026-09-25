import type { ComponentProps } from "react"
import { CommandConfirmDialog } from "@/components/CommandConfirmDialog"
import { AssistantPanel } from "@/components/command-palette/AssistantPanel"
import { CommandListView } from "@/components/command-palette/CommandListView"
import { EditorPanel } from "@/components/command-palette/EditorPanel"
import { EntityListView } from "@/components/command-palette/EntityListView"
import { SearchResultsView } from "@/components/command-palette/SearchResultsView"
import type { PalettePanel } from "@/lib/commands/palette-shell"
import type { CommandContext } from "@/lib/commands/types"

export interface PalettePanelViewProps {
  panel: PalettePanel | null
  context: CommandContext
  confirmPayload: unknown
  onConfirm: () => Promise<void>
  onBack: () => void
  editor: Omit<
    ComponentProps<typeof EditorPanel>,
    "command" | "fieldLabel" | "field" | "onBack"
  >
  entity: Omit<ComponentProps<typeof EntityListView>, "command" | "onBack">
  searchResults: Omit<
    ComponentProps<typeof SearchResultsView>,
    "command" | "state" | "onBack"
  >
  commandList: ComponentProps<typeof CommandListView>
}

/** Renders the palette's one active panel from what `activePalettePanel` chose. */
export function PalettePanelView({
  panel,
  context,
  confirmPayload,
  onConfirm,
  onBack,
  editor,
  entity,
  searchResults,
  commandList,
}: PalettePanelViewProps) {
  switch (panel?.kind) {
    case "confirm":
      return (
        <CommandConfirmDialog
          command={panel.command}
          context={context}
          payload={confirmPayload}
          onCancel={onBack}
          onConfirm={onConfirm}
        />
      )
    case "assistant":
      return <AssistantPanel onBack={onBack} />
    case "editor":
      return (
        <EditorPanel
          {...editor}
          command={panel.command}
          fieldLabel={panel.fieldLabel}
          field={panel.command.editorField}
          onBack={onBack}
        />
      )
    case "entity":
      return (
        <EntityListView {...entity} command={panel.command} onBack={onBack} />
      )
    case "search-results":
      return (
        <SearchResultsView
          {...searchResults}
          command={panel.command}
          state={panel.state}
          onBack={onBack}
        />
      )
    case "commands":
      return <CommandListView {...commandList} />
    default:
      return null
  }
}
