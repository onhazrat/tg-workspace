import { ArrowLeft, Check } from "lucide-react"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { CommandConfirmDialog } from "@/components/CommandConfirmDialog"
import { useCommandPaletteContext } from "@/components/CommandPaletteProvider"
import {
  PaletteFooterHints,
  PaletteSubViewHeader,
} from "@/components/PaletteKeyboardChrome"
import { Badge } from "@/components/ui/badge"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
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
import { removeTagFromChannel } from "@/lib/channels/channel-tags"
import { normalizeChannelHandle } from "@/lib/commands/channel-ops"
import {
  findPostByEntityId,
  getExtendedEntityCandidates,
  isNonChannelEntityFlow,
} from "@/lib/commands/entity-candidates"
import {
  getChainedEditorApply,
  getChainedEditorField,
  runChainedChannelEntityPick,
} from "@/lib/commands/extended-commands"
import { filterAndRank } from "@/lib/commands/rank-commands"
import {
  pickSearchPost,
  pickSearchSummary,
  searchPostsForPalette,
  searchSummariesForPalette,
  semanticSearchPostsForPalette,
  truncatePreview,
} from "@/lib/commands/search-filters"
import type { CommandDef, EntityFlowType } from "@/lib/commands/types"
import {
  filterChannelsByQuery,
  getEntityCandidates,
  runEntityChannelAction,
} from "@/lib/commands/useChannelEntityFlow"
import { env } from "@/lib/env"
import type { Channel, Post, Summary } from "@/types"

function getStayOpenAnnouncement(flow: EntityFlowType): string {
  switch (flow) {
    case "select-channel":
      return "Channel selected, palette open"
    case "deselect-channel":
      return "Channel deselected, palette open"
    case "freeze-channel":
      return "Channel frozen, palette open"
    case "unfreeze-channel":
      return "Channel unfrozen, palette open"
    case "toggle-auto-follow":
      return "Auto-follow toggled, palette open"
    default:
      return "Selection updated, palette open"
  }
}

function groupCommands(commands: CommandDef[]): Map<string, CommandDef[]> {
  const groups = new Map<string, CommandDef[]>()
  for (const command of commands) {
    const existing = groups.get(command.group) ?? []
    existing.push(command)
    groups.set(command.group, existing)
  }
  return groups
}

export function CommandPalette() {
  useCommandPalette()
  const palette = useCommandPaletteContext()
  const { commands, context } = useCommandRegistry()
  const { affinityEntries, recordPick } = useCommandSearchAffinity()
  const { recentCommands, recordRecent } = useRecentCommands(commands)

  const [query, setQuery] = useState("")
  const [entityQuery, setEntityQuery] = useState("")
  const [editorValue, setEditorValue] = useState("")
  const [searchResultsQuery, setSearchResultsQuery] = useState("")
  const [isEditorApplying, setIsEditorApplying] = useState(false)
  const [liveAnnouncement, setLiveAnnouncement] = useState("")
  const commandListRef = useRef<HTMLDivElement>(null)
  const entityListRef = useRef<HTMLDivElement>(null)
  const searchResultsListRef = useRef<HTMLDivElement>(null)
  const commandInputRef = useRef<HTMLInputElement>(null)
  const entityInputRef = useRef<HTMLInputElement>(null)
  const searchResultsInputRef = useRef<HTMLInputElement>(null)
  const editorInputRef = useRef<HTMLInputElement>(null)
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null)

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
      setEntityQuery("")
      setQuery(palette.getRootQuery())
    }
    if (leaving === "editor") {
      setEditorValue("")
    }
    if (leaving === "search-results") {
      const preservedQuery = palette.searchResultsState?.query ?? editorValue
      setEditorValue(preservedQuery)
      setSearchResultsQuery("")
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
    handleSubViewBackspace(event, editorValue)
    if (event.defaultPrevented) return
    if (isEditorApplying) return

    if (event.key !== "Enter") return

    const shouldApply = options.isTextarea
      ? event.metaKey || event.ctrlKey
      : true
    if (!shouldApply) return

    event.preventDefault()
    void handleEditorApply()
  }

  // Reset input only when palette opens — not when jobToggles object identity changes.
  useEffect(() => {
    if (!open) return
    refreshJobStatus()
    setQuery("")
    setEntityQuery("")
    setEditorValue("")
    setSearchResultsQuery("")
    setIsEditorApplying(false)
    setLiveAnnouncement("")
  }, [open, refreshJobStatus])

  useEffect(() => {
    palette.rootQueryRef.current = query
  }, [palette, query])

  // Sub-view inputs mount after mode transitions; Radix Dialog keeps focus on
  // the dialog shell unless we explicitly move it to the search field.
  useEffect(() => {
    if (!open) return
    if (
      mode !== "commands" &&
      mode !== "entity" &&
      mode !== "search-results" &&
      mode !== "editor"
    ) {
      return
    }

    const inputRef =
      mode === "entity"
        ? entityInputRef
        : mode === "search-results"
          ? searchResultsInputRef
          : mode === "editor"
            ? editorInputRef
            : commandInputRef
    const frame = requestAnimationFrame(() => {
      if (mode === "editor") {
        ;(editorInputRef.current ?? editorTextareaRef.current)?.focus()
        return
      }
      inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [
    editorCommand?.id,
    entityCommand?.id,
    mode,
    open,
    searchResultsState?.kind,
  ])

  // Initialize from schema when opening an editor — not on every context change,
  // which would reset in-progress typing (e.g. add-channel getValue is always "").
  useEffect(() => {
    if (!editorCommand) return
    if (editorCommand.editorField) {
      const current = editorCommand.editorField.getValue(context)
      setEditorValue(String(current))
      return
    }
    const chained = getChainedEditorField(
      editorCommand.id,
      palette.entityPayload as Channel | undefined,
    )
    if (chained) {
      setEditorValue(chained.getValue())
    }
  }, [editorCommand?.id, palette.entityPayload])

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

  const groupedCommands = useMemo(() => {
    if (!isEmptyQuery) return groupCommands(rankedCommands)
    const recentIds = new Set(displayedRecents.map((command) => command.id))
    const others = commands.filter((command) => !recentIds.has(command.id))
    return groupCommands(others)
  }, [commands, displayedRecents, isEmptyQuery, rankedCommands])

  const firstNavigableId = isEmptyQuery
    ? (displayedRecents[0]?.id ??
      commands.find(
        (command) =>
          !displayedRecents.some((recent) => recent.id === command.id),
      )?.id ??
      "")
    : (rankedCommands[0]?.id ?? "")

  const { selectedId: selectedCommandId, setSelectedId: setSelectedCommandId } =
    usePaletteListSelection({
      isActive: mode === "commands",
      open,
      firstNavigableId,
      filterKey: query,
      listRef: commandListRef,
    })

  const entityCandidates = useMemo(() => {
    if (!entityCommand?.entityFlow) return []
    const flow = entityCommand.entityFlow
    if (isNonChannelEntityFlow(flow)) {
      const items = getExtendedEntityCandidates(
        flow,
        context,
        palette.entityPayload,
      )
      const normalizedQuery = entityQuery.trim().toLowerCase()
      if (!normalizedQuery) return items
      return items.filter(
        (item) =>
          item.label.toLowerCase().includes(normalizedQuery) ||
          item.id.toLowerCase().includes(normalizedQuery),
      )
    }
    const pool = getEntityCandidates(flow, context)
    return filterChannelsByQuery(pool, entityQuery)
  }, [context, entityCommand, entityQuery, palette.entityPayload])

  const firstEntityId = useMemo(() => {
    if (entityCandidates.length === 0) return ""
    const flow = entityCommand?.entityFlow ?? "search-channel"
    if (isNonChannelEntityFlow(flow)) {
      return (entityCandidates[0] as { id: string }).id
    }
    return (entityCandidates[0] as Channel).name
  }, [entityCandidates, entityCommand?.entityFlow])

  const { selectedId: selectedEntityId, setSelectedId: setSelectedEntityId } =
    usePaletteListSelection({
      isActive: mode === "entity",
      open,
      firstNavigableId: firstEntityId,
      filterKey: entityQuery,
      listRef: entityListRef,
    })

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

  const handleSelectCommand = async (command: CommandDef) => {
    const disabled = command.disabled?.(context)
    if (disabled?.disabled) return

    if (command.kind === "editor") {
      palette.openEditor(command)
      return
    }
    if (command.kind === "entity-root" && command.entityFlow) {
      setEntityQuery("")
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
    handleSubViewBackspace(event, entityQuery)
    if (event.defaultPrevented) return
    if (event.key !== "Enter") return

    const flow = entityCommand?.entityFlow
    if (!flow) return

    let pickId = ""
    if (isNonChannelEntityFlow(flow)) {
      pickId =
        selectedEntityId ||
        ((entityCandidates[0] as { id: string } | undefined)?.id ?? "")
    } else {
      const q = entityQuery.trim().toLowerCase()
      const channels = entityCandidates as Channel[]
      pickId =
        channels.find((channel) => channel.name.toLowerCase() === q)?.name ??
        channels.find((channel) => channel.name.toLowerCase().startsWith(q))
          ?.name ??
        selectedEntityId ??
        channels[0]?.name ??
        ""
    }
    if (!pickId) return

    event.preventDefault()
    void handleEntityPick(pickId)
  }

  const handleEntityPick = async (value: string) => {
    if (!entityCommand?.entityFlow) return
    const flow = entityCommand.entityFlow

    if (flow === "remove-tag-pick") {
      const channel = palette.entityPayload as Channel | undefined
      if (!channel) return
      await removeTagFromChannel(channel, value, context)
      const rootQuery = palette.getRootQuery()
      if (rootQuery.trim()) {
        recordPick(rootQuery, entityCommand.id)
      }
      recordRecent(entityCommand.id)
      close()
      return
    }

    if (flow === "delete-summary") {
      const summary = context.summariesHistory.find(
        (entry) => entry.id === value,
      )
      if (!summary) return
      if (entityCommand.requiresConfirmation) {
        palette.openConfirm(entityCommand, summary)
        return
      }
      await entityCommand.run(context, summary)
      await finishCommand(entityCommand)
      return
    }

    if (flow === "pick-post") {
      const post = findPostByEntityId(context.filteredPosts, value)
      if (!post) return
      await entityCommand.run(context, post)
      const rootQuery = palette.getRootQuery()
      if (rootQuery.trim()) {
        recordPick(rootQuery, entityCommand.id)
      }
      recordRecent(entityCommand.id)
      close()
      return
    }

    if (flow === "clear-db-table") {
      if (entityCommand.requiresConfirmation) {
        palette.openConfirm(entityCommand, value)
        return
      }
      await entityCommand.run(context, value)
      await finishCommand(entityCommand)
      return
    }

    const channel = context.channels.find((entry) => entry.name === value)
    if (!channel) return

    if (flow === "delete-channel" && entityCommand.requiresConfirmation) {
      palette.openConfirm(entityCommand, channel)
      return
    }

    if (flow === "reset-sync-channel" && entityCommand.requiresConfirmation) {
      palette.openConfirm(entityCommand, channel)
      return
    }

    const chained = await runChainedChannelEntityPick(flow, channel, context)
    if (chained === "editor") {
      const field = getChainedEditorField(entityCommand.id, channel)
      setEditorValue(field?.getValue() ?? "")
      palette.openEditor(entityCommand)
      return
    }
    if (chained === "tag-pick") {
      palette.setEntityCommand({
        ...entityCommand,
        entityFlow: "remove-tag-pick",
      })
      setEntityQuery("")
      requestAnimationFrame(() => {
        entityInputRef.current?.focus()
      })
      return
    }
    if (chained === "done") {
      const rootQuery = palette.getRootQuery()
      if (rootQuery.trim()) {
        recordPick(rootQuery, entityCommand.id)
      }
      recordRecent(entityCommand.id)
      close()
      return
    }

    await runEntityChannelAction(flow, channel, context)

    const shouldClose = entityCommand.closeOnPick !== false
    if (shouldClose) {
      const rootQuery = palette.getRootQuery()
      if (rootQuery.trim()) {
        recordPick(rootQuery, entityCommand.id)
      }
      recordRecent(entityCommand.id)
      close()
      return
    }

    setEntityQuery("")
    setLiveAnnouncement(getStayOpenAnnouncement(flow))
    requestAnimationFrame(() => {
      entityInputRef.current?.focus()
    })
  }

  const handleEditorApply = async () => {
    if (!editorCommand || isEditorApplying) return

    if (
      editorCommand.id === "add-tag-channel" ||
      editorCommand.id === "edit-channel-start-id"
    ) {
      setIsEditorApplying(true)
      try {
        await getChainedEditorApply(editorCommand.id, context, editorValue)
        recordRecent(editorCommand.id)
        close()
      } finally {
        setIsEditorApplying(false)
      }
      return
    }

    if (!editorCommand.editorField) return

    const normalizedHandle = normalizeChannelHandle(editorValue)
    if (
      editorCommand.id === "add-channel" &&
      !normalizedHandle &&
      !editorCommand.allowEmptyApply
    ) {
      return
    }

    if (editorCommand.editorField.advancedOnly) {
      context.settings.setAdvancedMode(true)
    }

    setIsEditorApplying(true)
    try {
      await editorCommand.editorField.apply(context, editorValue)

      if (editorCommand.searchResultsKind === "posts") {
        const query = editorValue.trim()
        const items =
          editorCommand.id === "semantic-search-posts"
            ? await semanticSearchPostsForPalette(context, query)
            : await searchPostsForPalette(context, query)
        palette.openSearchResults(
          { kind: "posts", query, items, totalCount: items.length },
          editorCommand,
        )
        setSearchResultsQuery("")
        recordRecent(editorCommand.id)
        return
      }

      if (editorCommand.searchResultsKind === "summaries") {
        const query = editorValue.trim()
        const items = searchSummariesForPalette(context, query)
        palette.openSearchResults(
          { kind: "summaries", query, items, totalCount: items.length },
          editorCommand,
        )
        setSearchResultsQuery("")
        recordRecent(editorCommand.id)
        return
      }

      recordRecent(editorCommand.id)

      const shouldClose = editorCommand.closeOnApply !== false
      if (shouldClose) {
        close()
        return
      }

      setEditorValue("")
      requestAnimationFrame(() => {
        ;(editorInputRef.current ?? editorTextareaRef.current)?.focus()
      })
    } finally {
      setIsEditorApplying(false)
    }
  }

  const filteredSearchResults = useMemo(() => {
    if (!searchResultsState) return []
    const query = searchResultsQuery.trim().toLowerCase()
    if (!query) return searchResultsState.items

    if (searchResultsState.kind === "posts") {
      return (searchResultsState.items as Post[]).filter((post) => {
        const haystack =
          `${post.channelName} ${post.text} ${post.date}`.toLowerCase()
        return haystack.includes(query)
      })
    }

    return (searchResultsState.items as Summary[]).filter((summary) => {
      const haystack = [
        summary.channels.join(" "),
        summary.text,
        summary.promptText ?? "",
        summary.model ?? "",
        summary.note ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [searchResultsQuery, searchResultsState])

  const firstSearchResultId = useMemo(() => {
    if (filteredSearchResults.length === 0) return ""
    if (searchResultsState?.kind === "posts") {
      const post = filteredSearchResults[0] as Post
      return `${post.channelName}_${post.id}`
    }
    return (filteredSearchResults[0] as Summary).id
  }, [filteredSearchResults, searchResultsState?.kind])

  const {
    selectedId: selectedSearchResultId,
    setSelectedId: setSelectedSearchResultId,
  } = usePaletteListSelection({
    isActive: mode === "search-results",
    open,
    firstNavigableId: firstSearchResultId,
    filterKey: `${searchResultsQuery}:${searchResultsState?.items.length ?? 0}`,
    listRef: searchResultsListRef,
  })

  const handleSearchResultPick = (item: Post | Summary) => {
    if (!searchResultsCommand || !searchResultsState) return

    if (searchResultsState.kind === "posts") {
      pickSearchPost(context, item as Post)
    } else {
      pickSearchSummary(context, item as Summary)
    }

    const rootQuery = palette.getRootQuery()
    if (rootQuery.trim()) {
      recordPick(rootQuery, searchResultsCommand.id)
    }
    recordRecent(searchResultsCommand.id)
    close()
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

  const editorFooterHint =
    activeEditorField?.type === "textarea"
      ? "⌃↵ apply · esc back · ⌫ parent"
      : "↵ apply · esc back · ⌫ parent"

  const renderBadge = (command: CommandDef) => {
    const badge = command.getBadge?.(context)
    if (!badge) return null
    return (
      <Badge
        variant={badge === "ON" ? "default" : "secondary"}
        className="ml-auto text-[11px] uppercase tracking-wider"
      >
        {badge}
      </Badge>
    )
  }

  const renderDisabledHint = (command: CommandDef) => {
    const state = command.disabled?.(context)
    if (!state?.disabled || !state.reason) return null
    return (
      <span className="ml-2 text-[11px] text-app-ink/60">{state.reason}</span>
    )
  }

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
              await finishCommand(command, undefined, palette.confirmPayload)
            }}
          />
        ) : null}

        {mode === "assistant" ? (
          <div className="space-y-4 p-6">
            <button
              type="button"
              onClick={goBackSubView}
              className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-app-ink/60 hover:text-app-ink"
            >
              <ArrowLeft size={14} />
              Back
            </button>
            <p className="text-sm text-app-ink/80">
              Natural language commands — coming soon
            </p>
          </div>
        ) : null}

        {showEditorPanel && editorCommand ? (
          <div className="space-y-0">
            <PaletteSubViewHeader
              label={editorCommand.label}
              onBack={goBackSubView}
            />
            <div className="space-y-4 p-4">
              <div className="space-y-2">
                <label
                  htmlFor="command-palette-editor"
                  className="text-xs font-mono uppercase tracking-widest text-app-ink/60"
                >
                  {chainedEditorField?.label ?? activeEditorField?.label}
                </label>
                {activeEditorField?.type === "textarea" ? (
                  <textarea
                    ref={editorTextareaRef}
                    id="command-palette-editor"
                    value={editorValue}
                    onChange={(event) => setEditorValue(event.target.value)}
                    onKeyDown={(event) =>
                      handleEditorKeyDown(event, { isTextarea: true })
                    }
                    disabled={isEditorApplying}
                    className="min-h-28 w-full rounded-md border border-app-ink/20 bg-app-bg p-3 text-sm disabled:opacity-50"
                  />
                ) : (
                  <input
                    ref={editorInputRef}
                    id="command-palette-editor"
                    type={(() => {
                      const field = activeEditorField
                      if (!field) return "text"
                      if (field.id === "globalStartTimeValue") {
                        return context.settings.globalStartTimeMode ===
                          "absolute"
                          ? "datetime-local"
                          : "number"
                      }
                      return field.type === "number" ? "number" : "text"
                    })()}
                    min={activeEditorField?.min}
                    max={activeEditorField?.max}
                    step={activeEditorField?.step}
                    value={editorValue}
                    onChange={(event) => setEditorValue(event.target.value)}
                    onKeyDown={(event) =>
                      handleEditorKeyDown(event, { isTextarea: false })
                    }
                    disabled={isEditorApplying}
                    className="w-full rounded-md border border-app-ink/20 bg-app-bg p-3 text-sm disabled:opacity-50"
                  />
                )}
              </div>
              <button
                type="button"
                data-testid="command-palette-editor-apply"
                disabled={isEditorApplying}
                onClick={handleEditorApply}
                className="inline-flex items-center gap-2 rounded-md border border-app-ink/20 bg-app-ink px-3 py-2 text-xs font-mono uppercase tracking-widest text-app-bg disabled:opacity-50"
              >
                <Check size={14} />
                {isEditorApplying ? "Applying…" : "Apply"}
              </button>
            </div>
            <PaletteFooterHints hints={editorFooterHint} />
          </div>
        ) : null}

        {mode === "entity" && entityCommand ? (
          <Command
            shouldFilter={false}
            loop
            value={selectedEntityId}
            onValueChange={setSelectedEntityId}
            className="bg-app-card"
          >
            <PaletteSubViewHeader
              label={entityCommand.label}
              onBack={goBackSubView}
            />
            <CommandInput
              ref={entityInputRef}
              placeholder={
                isNonChannelEntityFlow(
                  entityCommand.entityFlow ?? "search-channel",
                )
                  ? "Filter..."
                  : "Name, display name, tag, #tag, or tag:tag..."
              }
              value={entityQuery}
              onValueChange={setEntityQuery}
              onKeyDown={handleEntityInputKeyDown}
            />
            <CommandList ref={entityListRef}>
              <CommandEmpty>
                {entityCommand.entityFlow === "deselect-channel" &&
                !entityQuery.trim()
                  ? "No channels selected."
                  : entityCommand.entityFlow === "pick-post"
                    ? "No posts in current filter. Try widening the date range."
                    : entityCommand.entityFlow === "delete-summary"
                      ? "No summaries in history."
                      : entityCommand.entityFlow === "remove-tag-pick"
                        ? "No tags on this channel."
                        : "No matches found."}
              </CommandEmpty>
              <CommandGroup
                heading={
                  isNonChannelEntityFlow(
                    entityCommand.entityFlow ?? "search-channel",
                  )
                    ? entityCommand.entityFlow === "delete-summary"
                      ? "Summaries"
                      : entityCommand.entityFlow === "pick-post"
                        ? "Posts"
                        : entityCommand.entityFlow === "clear-db-table"
                          ? "Tables"
                          : "Tags"
                    : "Channels"
                }
              >
                {isNonChannelEntityFlow(
                  entityCommand.entityFlow ?? "search-channel",
                )
                  ? entityCandidates.map((item, index) => (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        data-testid={
                          index === 0
                            ? "command-palette-entity-item-first"
                            : undefined
                        }
                        onSelect={() => handleEntityPick(item.id)}
                      >
                        <span className="truncate">{item.label}</span>
                      </CommandItem>
                    ))
                  : (entityCandidates as Channel[]).map((channel, index) => (
                      <CommandItem
                        key={channel.id}
                        value={channel.name}
                        data-testid={
                          index === 0
                            ? "command-palette-entity-item-first"
                            : undefined
                        }
                        onSelect={() => handleEntityPick(channel.name)}
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
        ) : null}

        {mode === "search-results" &&
        searchResultsState &&
        searchResultsCommand ? (
          <Command
            shouldFilter={false}
            loop
            value={selectedSearchResultId}
            onValueChange={setSelectedSearchResultId}
            className="bg-app-card"
            data-testid="command-palette-search-results"
          >
            <PaletteSubViewHeader
              label={`${searchResultsCommand.label}${
                searchResultsState.query
                  ? ` — "${searchResultsState.query}"`
                  : ""
              }`}
              onBack={goBackSubView}
            />
            <CommandInput
              ref={searchResultsInputRef}
              placeholder="Filter results..."
              value={searchResultsQuery}
              onValueChange={setSearchResultsQuery}
              onKeyDown={(event) =>
                handleSubViewBackspace(event, searchResultsQuery)
              }
            />
            <CommandList ref={searchResultsListRef}>
              <CommandEmpty>
                {searchResultsState.query.trim()
                  ? "No matching results. Try a different query or widen the date range."
                  : "No results in the current date range or history."}
              </CommandEmpty>
              <CommandGroup
                heading={
                  searchResultsState.kind === "posts" ? "Posts" : "Summaries"
                }
              >
                {searchResultsState.kind === "posts"
                  ? (filteredSearchResults as Post[]).map((post) => (
                      <CommandItem
                        key={`${post.channelName}_${post.id}`}
                        value={`${post.channelName}_${post.id}`}
                        data-testid={`command-palette-search-result-${post.channelName}_${post.id}`}
                        onSelect={() => handleSearchResultPick(post)}
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
                  : (filteredSearchResults as Summary[]).map((summary) => (
                      <CommandItem
                        key={summary.id}
                        value={summary.id}
                        data-testid={`command-palette-search-result-${summary.id}`}
                        onSelect={() => handleSearchResultPick(summary)}
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm">
                            {summary.channels.join(", ") || "Summary"}
                          </span>
                          <span className="truncate text-xs text-app-ink/60">
                            {truncatePreview(
                              summary.promptText || summary.text,
                            )}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : null}

        {mode === "commands" ? (
          <Command
            shouldFilter={false}
            loop
            value={selectedCommandId}
            onValueChange={setSelectedCommandId}
            className="bg-app-card"
          >
            <CommandInput
              ref={commandInputRef}
              placeholder="Type a command..."
              value={query}
              onValueChange={setQuery}
              onKeyDown={handleCommandInputKeyDown}
            />
            <CommandList ref={commandListRef}>
              <CommandEmpty>No commands found.</CommandEmpty>
              {isEmptyQuery && displayedRecents.length > 0 ? (
                <CommandGroup heading="Recent">
                  {displayedRecents.map((command) => {
                    const disabled = command.disabled?.(context)
                    return (
                      <CommandItem
                        key={`recent-${command.id}`}
                        value={command.id}
                        disabled={disabled?.disabled}
                        onSelect={() => handleSelectCommand(command)}
                      >
                        <span>{command.label}</span>
                        {renderDisabledHint(command)}
                        {renderBadge(command)}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ) : null}
              {[...groupedCommands.entries()].map(
                ([group, groupCommandsList]) => (
                  <CommandGroup key={group} heading={group}>
                    {groupCommandsList.map((command) => {
                      const disabled = command.disabled?.(context)
                      return (
                        <CommandItem
                          key={command.id}
                          value={command.id}
                          disabled={disabled?.disabled}
                          onSelect={() => handleSelectCommand(command)}
                        >
                          <span>{command.label}</span>
                          {renderDisabledHint(command)}
                          {renderBadge(command)}
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                ),
              )}
            </CommandList>
            <PaletteFooterHints hints="↵ run · esc close · ⌫ parent" />
          </Command>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
