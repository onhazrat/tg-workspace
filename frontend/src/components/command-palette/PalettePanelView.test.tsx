/**
 * Which component the palette mounts for each panel, and what it is handed.
 * The panels are called as plain functions and their elements inspected, so
 * nothing below them mounts.
 */
import { describe, expect, test } from "bun:test"
import type { ReactElement } from "react"
import { CommandConfirmDialog } from "@/components/CommandConfirmDialog"
import { AssistantPanel } from "@/components/command-palette/AssistantPanel"
import { CommandListView } from "@/components/command-palette/CommandListView"
import { EditorPanel } from "@/components/command-palette/EditorPanel"
import { EntityListView } from "@/components/command-palette/EntityListView"
import {
  PalettePanelView,
  type PalettePanelViewProps,
} from "@/components/command-palette/PalettePanelView"
import { SearchResultsView } from "@/components/command-palette/SearchResultsView"
import type { PalettePanel } from "@/lib/commands/palette-shell"
import type {
  CommandContext,
  CommandDef,
  SearchResultsState,
} from "@/lib/commands/types"

const context = { marker: "ctx" } as unknown as CommandContext
const onBack = () => {}
const onConfirm = async () => {}
const field = {
  id: "f",
  label: "Own label",
  type: "text" as const,
  getValue: () => "",
  apply: () => {},
}
const command: CommandDef = {
  id: "cmd",
  kind: "editor",
  label: "Cmd",
  keywords: [],
  group: "Test",
  editorField: field,
  run: () => {},
}

const props = {
  context,
  confirmPayload: { payload: 1 },
  onConfirm,
  onBack,
  editor: { value: "typed", onKeyDown: () => {} },
  entity: { entityQuery: "ent" },
  searchResults: { filterQuery: "flt" },
  commandList: { query: "cmd-q" },
} as unknown as Omit<PalettePanelViewProps, "panel">

function view(panel: PalettePanel | null) {
  return PalettePanelView({ ...props, panel }) as ReactElement<
    Record<string, unknown>
  > | null
}

describe("PalettePanelView", () => {
  test("renders nothing without a panel", () => {
    expect(view(null)).toBeNull()
  })

  test("confirm hands the command, context and payload to the dialog", () => {
    const element = view({ kind: "confirm", command })
    expect(element?.type).toBe(CommandConfirmDialog)
    expect(element?.props).toEqual({
      command,
      context,
      payload: props.confirmPayload,
      onCancel: onBack,
      onConfirm,
    })
  })

  test("assistant only needs the way back", () => {
    const element = view({ kind: "assistant" })
    expect(element?.type).toBe(AssistantPanel)
    expect(element?.props).toEqual({ onBack })
  })

  test("editor spreads its view props and takes the field from the command", () => {
    const element = view({ kind: "editor", command, fieldLabel: "Chosen" })
    expect(element?.type).toBe(EditorPanel)
    expect(element?.props).toEqual({
      ...props.editor,
      command,
      fieldLabel: "Chosen",
      field,
      onBack,
    })
  })

  test("entity spreads its view props with the command", () => {
    const element = view({ kind: "entity", command })
    expect(element?.type).toBe(EntityListView)
    expect(element?.props).toEqual({ ...props.entity, command, onBack })
  })

  test("search results pass the state along", () => {
    const state = { kind: "posts", query: "q" } as SearchResultsState
    const element = view({ kind: "search-results", command, state })
    expect(element?.type).toBe(SearchResultsView)
    expect(element?.props).toEqual({
      ...props.searchResults,
      command,
      state,
      onBack,
    })
  })

  test("the root list gets its props unchanged", () => {
    const element = view({ kind: "commands" })
    expect(element?.type).toBe(CommandListView)
    expect(element?.props).toEqual({ ...props.commandList })
  })
})
