import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useCommandPaletteContext } from "@/components/CommandPaletteProvider"
import { PalettePanelView } from "@/components/command-palette/PalettePanelView"
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
import {
  activePalettePanel,
  closeButtonTabIndex,
  commandEnterTarget,
  confirmStaysInEntity,
  editorEnterApplies,
  entityEnterPickId,
  isBackspaceBack,
  pickRecordedOnBack,
  type SelectAction,
  selectCommandAction,
} from "@/lib/commands/palette-shell"
import {
  getFirstNavigableCommandId,
  getGroupedPaletteCommands,
} from "@/lib/commands/palette-view-model"
import { filterAndRank } from "@/lib/commands/rank-commands"
import type { CommandDef, PaletteMode } from "@/lib/commands/types"
import { env } from "@/lib/env"

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

  /** Counts a command as used: its search affinity and the recents list. */
  const recordUse = (commandId: string, rootQuery: string) => {
    if (rootQuery.trim()) recordPick(rootQuery, commandId)
    recordRecent(commandId)
  }

  const finishCommand = async (
    command: CommandDef,
    rootQuery?: string,
    payload?: unknown,
  ) => {
    await command.run(context, payload)
    recordUse(command.id, rootQuery ?? palette.getRootQuery())
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

  /** What leaving each sub-view resets once the mode has popped. */
  const leaveSubView: Partial<Record<PaletteMode, () => void>> = {
    entity: () => {
      entity.setEntityQuery("")
      setQuery(palette.getRootQuery())
    },
    editor: () => editor.setEditorValue(""),
    "search-results": () => {
      editor.setEditorValue(
        palette.searchResultsState?.query ?? editor.editorValue,
      )
      searchResults.setFilterQuery("")
    },
  }

  const goBackSubView = () => {
    if (modeStack.length <= 1) return
    const leaving = mode
    const recorded = pickRecordedOnBack(leaving, entityCommand)
    if (recorded) recordUse(recorded.id, palette.getRootQuery())
    popMode()
    leaveSubView[leaving]?.()
  }

  const handleSubViewBackspace = (
    event: KeyboardEvent,
    searchValue: string,
  ) => {
    if (!isBackspaceBack(event.key, searchValue, modeStack.length)) return
    event.preventDefault()
    goBackSubView()
  }

  const handleEditorKeyDown = (
    event: KeyboardEvent,
    options: { isTextarea: boolean },
  ) => {
    handleSubViewBackspace(event, editor.editorValue)
    if (event.defaultPrevented) return
    if (!editorEnterApplies(event, options.isTextarea, editor.isApplying))
      return
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

  const selectActions: Record<
    SelectAction,
    (command: CommandDef) => void | Promise<void>
  > = {
    disabled: () => {},
    editor: (command) => palette.openEditor(command),
    entity: (command) => {
      entity.setEntityQuery("")
      palette.openEntity(command)
    },
    assistant: () => palette.pushMode("assistant"),
    confirm: (command) => palette.openConfirm(command),
    run: (command) => finishCommand(command),
  }

  const handleSelectCommand = async (command: CommandDef) => {
    await selectActions[selectCommandAction(command, context)](command)
  }

  const handleCommandInputKeyDown = (event: KeyboardEvent) => {
    handleSubViewBackspace(event, query)
    if (event.defaultPrevented) return
    const command = commandEnterTarget(
      event,
      commands,
      rankedCommands,
      selectedCommandId,
    )
    if (!command) return
    event.preventDefault()
    void handleSelectCommand(command)
  }

  const handleEntityInputKeyDown = (event: KeyboardEvent) => {
    handleSubViewBackspace(event, entity.entityQuery)
    if (event.defaultPrevented) return
    const pickId = entityEnterPickId(event.key, entityCommand, entity)
    if (!pickId) return
    event.preventDefault()
    void entity.handlePick(pickId)
  }

  const handleConfirm = async () => {
    const command = palette.pendingCommand
    if (!command) return
    if (confirmStaysInEntity(command, entityCommand)) {
      await entity.finishEntityConfirm(command, palette.confirmPayload)
      return
    }
    await finishCommand(command, undefined, palette.confirmPayload)
  }

  const panel = activePalettePanel({
    mode,
    pendingCommand: palette.pendingCommand,
    editorCommand,
    entityCommand,
    entityPayload: palette.entityPayload,
    searchResultsState,
    searchResultsCommand,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close()
      }}
    >
      <DialogContent
        showCloseButton
        closeButtonTabIndex={closeButtonTabIndex(mode)}
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

        <PalettePanelView
          panel={panel}
          context={context}
          confirmPayload={palette.confirmPayload}
          onConfirm={handleConfirm}
          onBack={goBackSubView}
          editor={{
            ...editor.viewProps,
            globalStartTimeMode: context.settings.globalStartTimeMode,
            onKeyDown: handleEditorKeyDown,
          }}
          entity={{
            ...entity.viewProps,
            onInputKeyDown: handleEntityInputKeyDown,
          }}
          searchResults={{
            ...searchResults.viewProps,
            onInputKeyDown: (event) =>
              handleSubViewBackspace(event, searchResults.filterQuery),
          }}
          commandList={{
            query,
            onQueryChange: setQuery,
            onInputKeyDown: handleCommandInputKeyDown,
            selectedId: selectedCommandId,
            onSelectedIdChange: setSelectedCommandId,
            inputRef: commandInputRef,
            listRef: commandListRef,
            isEmptyQuery,
            displayedRecents,
            groupedCommands,
            context,
            onSelectCommand: handleSelectCommand,
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
