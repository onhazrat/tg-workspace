import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { CommandConfirmDialog } from "@/components/CommandConfirmDialog"
import { useCommandPaletteContext } from "@/components/CommandPaletteProvider"
import { AssistantPanel } from "@/components/command-palette/AssistantPanel"
import { CommandListView } from "@/components/command-palette/CommandListView"
import { EditorPanel } from "@/components/command-palette/EditorPanel"
import { EntityListView } from "@/components/command-palette/EntityListView"
import { SearchResultsView } from "@/components/command-palette/SearchResultsView"
import { useEditorFlow } from "@/components/command-palette/useEditorFlow"
import { useEntityFlow } from "@/components/command-palette/useEntityFlow"
import { usePaletteFocus } from "@/components/command-palette/usePaletteFocus"
import { useSearchResultsFlow } from "@/components/command-palette/useSearchResultsFlow"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCommandPalette } from "@/hooks/useCommandPalette"
import { useCommandRegistry } from "@/hooks/useCommandRegistry"
import { useCommandSearchAffinity } from "@/hooks/useCommandSearchAffinity"
import { usePaletteListSelection } from "@/hooks/usePaletteListSelection"
import { useRecentCommands } from "@/hooks/useRecentCommands"
import { getChainedEditorField } from "@/lib/commands/extended-commands"
import {
  getFirstNavigableCommandId,
  getGroupedPaletteCommands,
  resolveEntityPickId,
} from "@/lib/commands/palette-view-model"
import { filterAndRank } from "@/lib/commands/rank-commands"
import type { CommandDef } from "@/lib/commands/types"
import { env } from "@/lib/env"
import type { Channel } from "@/types"

export function CommandPalette() {
  useCommandPalette()
  const palette = useCommandPaletteContext()
  const { commands, context } = useCommandRegistry()
  const { affinityEntries, recordPick } = useCommandSearchAffinity()
  const { recentCommands, recordRecent } = useRecentCommands(commands)

  const [query, setQuery] = useState("")
  const [liveAnnouncement, setLiveAnnouncement] = useState("")
  const commandListRef = useRef<HTMLDivElement>(null)
  const commandInputRef = useRef<HTMLInputElement>(null)

  const {
    open,
    close,
    popMode,
    mode,
    modeStack,
    entityCommand,
    editorCommand,
    searchResultsState,
    searchResultsCommand,
  } = palette
  const { refreshJobStatus } = context.jobToggles

  const finishCommand = async (
    command: CommandDef,
    rootQuery?: string,
    payload?: unknown,
  ) => {
    await command.run(context, payload)
    const affinityQuery = rootQuery ?? palette.getRootQuery()
    if (affinityQuery.trim()) {
      recordPick(affinityQuery, command.id)
    }
    recordRecent(command.id)
    close()
  }

  const searchResults = useSearchResultsFlow({
    open,
    isActive: mode === "search-results",
    searchResultsState,
    searchResultsCommand,
    context,
    getRootQuery: palette.getRootQuery,
    recordPick,
    recordRecent,
    close,
  })

  const editor = useEditorFlow({
    editorCommand,
    context,
    entityPayload: palette.entityPayload,
    openSearchResults: palette.openSearchResults,
    close,
    recordRecent,
    onSearchResultsOpened: () => searchResults.setFilterQuery(""),
  })

  const entity = useEntityFlow({
    open,
    isActive: mode === "entity",
    palette,
    context,
    recordPick,
    recordRecent,
    finishCommand,
    setEditorValue: editor.setEditorValue,
    setLiveAnnouncement,
  })

  const goBackSubView = () => {
    if (modeStack.length <= 1) return
    const leaving = mode
    if (leaving === "entity" && entityCommand?.closeOnPick === false) {
      const rootQuery = palette.getRootQuery()
      if (rootQuery.trim()) {
        recordPick(rootQuery, entityCommand.id)
      }
      recordRecent(entityCommand.id)
    }
    popMode()
    if (leaving === "entity") {
      entity.setEntityQuery("")
      setQuery(palette.getRootQuery())
    }
    if (leaving === "editor") {
      editor.setEditorValue("")
    }
    if (leaving === "search-results") {
      const preservedQuery =
        palette.searchResultsState?.query ?? editor.editorValue
      editor.setEditorValue(preservedQuery)
      searchResults.setFilterQuery("")
    }
  }

  const handleSubViewBackspace = (
    event: KeyboardEvent,
    searchValue: string,
  ) => {
    if (event.key !== "Backspace" || searchValue.trim() !== "") return
    if (modeStack.length <= 1) return
    event.preventDefault()
    goBackSubView()
  }

  const handleEditorKeyDown = (
    event: KeyboardEvent,
    options: { isTextarea: boolean },
  ) => {
    handleSubViewBackspace(event, editor.editorValue)
    if (event.defaultPrevented) return
    if (editor.isApplying) return

    if (event.key !== "Enter") return

    const shouldApply = options.isTextarea
      ? event.metaKey || event.ctrlKey
      : true
    if (!shouldApply) return

    event.preventDefault()
    void editor.handleApply()
  }

  // Reset input only when palette opens — not when jobToggles object identity changes.
  useEffect(() => {
    if (!open) return
    refreshJobStatus()
    setQuery("")
    entity.setEntityQuery("")
    editor.resetEditor()
    searchResults.setFilterQuery("")
    setLiveAnnouncement("")
  }, [open, refreshJobStatus])

  useEffect(() => {
    palette.rootQueryRef.current = query
  }, [palette, query])

  usePaletteFocus({
    open,
    mode,
    editorCommandId: editorCommand?.id,
    entityCommandId: entityCommand?.id,
    searchResultsKind: searchResultsState?.kind,
    commandInputRef,
    entityInputRef: entity.inputRef,
    searchResultsInputRef: searchResults.inputRef,
    editorInputRef: editor.inputRef,
    editorTextareaRef: editor.textareaRef,
  })

  const rankedCommands = useMemo(() => {
    return filterAndRank(commands, query, affinityEntries).map(
      (entry) => entry.command,
    )
  }, [affinityEntries, commands, query])

  const displayedRecents = useMemo(
    () => recentCommands.slice(0, env.commandPaletteRecentCount),
    [recentCommands],
  )

  const isEmptyQuery = !query.trim()

  const groupedCommands = useMemo(
    () =>
      getGroupedPaletteCommands({
        isEmptyQuery,
        commands,
        rankedCommands,
        displayedRecents,
      }),
    [commands, displayedRecents, isEmptyQuery, rankedCommands],
  )

  const firstNavigableId = getFirstNavigableCommandId({
    isEmptyQuery,
    commands,
    rankedCommands,
    displayedRecents,
  })

  const { selectedId: selectedCommandId, setSelectedId: setSelectedCommandId } =
    usePaletteListSelection({
      isActive: mode === "commands",
      open,
      firstNavigableId,
      filterKey: query,
      listRef: commandListRef,
    })

  const handleSelectCommand = async (command: CommandDef) => {
    const disabled = command.disabled?.(context)
    if (disabled?.disabled) return

    if (command.kind === "editor") {
      palette.openEditor(command)
      return
    }
    if (command.kind === "entity-root" && command.entityFlow) {
      entity.setEntityQuery("")
      palette.openEntity(command)
      return
    }
    if (command.kind === "assistant") {
      palette.pushMode("assistant")
      return
    }
    if (command.requiresConfirmation) {
      palette.openConfirm(command)
      return
    }

    await finishCommand(command)
  }

  const handleCommandInputKeyDown = (event: KeyboardEvent) => {
    handleSubViewBackspace(event, query)
    if (event.defaultPrevented) return
    if (event.key !== "Enter") return
    const isModifierEnter = event.metaKey || event.ctrlKey
    if (event.shiftKey && !isModifierEnter) return

    const command =
      commands.find((entry) => entry.id === selectedCommandId) ??
      rankedCommands.find((entry) => entry.id === selectedCommandId) ??
      rankedCommands[0]
    if (!command) return

    event.preventDefault()
    void handleSelectCommand(command)
  }

  const handleEntityInputKeyDown = (event: KeyboardEvent) => {
    handleSubViewBackspace(event, entity.entityQuery)
    if (event.defaultPrevented) return
    if (event.key !== "Enter") return

    const flow = entityCommand?.entityFlow
    if (!flow) return

    const pickId = resolveEntityPickId({
      flow,
      entityQuery: entity.entityQuery,
      candidates: entity.candidates,
      selectedEntityId: entity.selectedId,
    })
    if (!pickId) return

    event.preventDefault()
    void entity.handlePick(pickId)
  }

  const isListMode =
    mode === "commands" || mode === "entity" || mode === "search-results"

  const chainedEditorField = editorCommand
    ? getChainedEditorField(
        editorCommand.id,
        palette.entityPayload as Channel | undefined,
      )
    : null
  const activeEditorField = editorCommand?.editorField
  const showEditorPanel = Boolean(
    mode === "editor" &&
      editorCommand &&
      (activeEditorField || chainedEditorField),
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close()
      }}
    >
      <DialogContent
        showCloseButton
        closeButtonTabIndex={isListMode ? -1 : undefined}
        className="overflow-hidden border-app-ink/20 bg-app-card p-0 sm:max-w-xl"
        data-testid="command-palette"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (modeStack.length > 1) {
            event.preventDefault()
            goBackSubView()
          }
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>Search commands and settings</DialogDescription>
        </DialogHeader>
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {liveAnnouncement}
        </div>

        {mode === "confirm" && palette.pendingCommand ? (
          <CommandConfirmDialog
            command={palette.pendingCommand}
            context={context}
            payload={palette.confirmPayload}
            onCancel={goBackSubView}
            onConfirm={async () => {
              const command = palette.pendingCommand
              if (!command) return
              const stayInEntity =
                entityCommand?.closeOnPick === false &&
                command.id === entityCommand.id
              if (stayInEntity) {
                await entity.finishEntityConfirm(
                  command,
                  palette.confirmPayload,
                )
                return
              }
              await finishCommand(command, undefined, palette.confirmPayload)
            }}
          />
        ) : null}

        {mode === "assistant" ? (
          <AssistantPanel onBack={goBackSubView} />
        ) : null}

        {showEditorPanel && editorCommand ? (
          <EditorPanel
            {...editor.viewProps}
            command={editorCommand}
            fieldLabel={chainedEditorField?.label ?? activeEditorField?.label}
            field={activeEditorField}
            globalStartTimeMode={context.settings.globalStartTimeMode}
            onKeyDown={handleEditorKeyDown}
            onBack={goBackSubView}
          />
        ) : null}

        {mode === "entity" && entityCommand ? (
          <EntityListView
            {...entity.viewProps}
            command={entityCommand}
            onInputKeyDown={handleEntityInputKeyDown}
            onBack={goBackSubView}
          />
        ) : null}

        {mode === "search-results" &&
        searchResultsState &&
        searchResultsCommand ? (
          <SearchResultsView
            {...searchResults.viewProps}
            command={searchResultsCommand}
            state={searchResultsState}
            onInputKeyDown={(event) =>
              handleSubViewBackspace(event, searchResults.filterQuery)
            }
            onBack={goBackSubView}
          />
        ) : null}

        {mode === "commands" ? (
          <CommandListView
            query={query}
            onQueryChange={setQuery}
            onInputKeyDown={handleCommandInputKeyDown}
            selectedId={selectedCommandId}
            onSelectedIdChange={setSelectedCommandId}
            inputRef={commandInputRef}
            listRef={commandListRef}
            isEmptyQuery={isEmptyQuery}
            displayedRecents={displayedRecents}
            groupedCommands={groupedCommands}
            context={context}
            onSelectCommand={handleSelectCommand}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
