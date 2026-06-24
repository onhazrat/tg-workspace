import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"

import type {
  CommandDef,
  PaletteControls,
  PaletteMode,
  SearchResultsState,
} from "@/lib/commands/types"

interface CommandPaletteContextValue extends PaletteControls {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  mode: PaletteMode
  modeStack: PaletteMode[]
  pendingCommand: CommandDef | null
  setPendingCommand: (command: CommandDef | null) => void
  entityCommand: CommandDef | null
  setEntityCommand: (command: CommandDef | null) => void
  editorCommand: CommandDef | null
  setEditorCommand: (command: CommandDef | null) => void
  rootQueryRef: MutableRefObject<string>
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null,
)

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false)
  const [modeStack, setModeStack] = useState<PaletteMode[]>(["commands"])
  const [pendingCommand, setPendingCommand] = useState<CommandDef | null>(null)
  const [entityCommand, setEntityCommand] = useState<CommandDef | null>(null)
  const [editorCommand, setEditorCommand] = useState<CommandDef | null>(null)
  const [confirmPayload, setConfirmPayload] = useState<unknown>(null)
  const [searchResultsState, setSearchResultsState] =
    useState<SearchResultsState | null>(null)
  const [searchResultsCommand, setSearchResultsCommand] =
    useState<CommandDef | null>(null)
  const rootQueryRef = useRef("")

  const mode = modeStack[modeStack.length - 1] ?? "commands"

  const resetModes = useCallback(() => {
    setModeStack(["commands"])
    setPendingCommand(null)
    setEntityCommand(null)
    setEditorCommand(null)
    setConfirmPayload(null)
    setSearchResultsState(null)
    setSearchResultsCommand(null)
    rootQueryRef.current = ""
  }, [])

  const setOpen = useCallback(
    (next: boolean) => {
      if (next) {
        setModeStack(["commands"])
        setPendingCommand(null)
        setEntityCommand(null)
        setEditorCommand(null)
        setConfirmPayload(null)
        setSearchResultsState(null)
        setSearchResultsCommand(null)
        rootQueryRef.current = ""
      } else {
        resetModes()
      }
      setOpenState(next)
    },
    [resetModes],
  )

  const close = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  const toggle = useCallback(() => {
    setOpen(!open)
  }, [open, setOpen])

  const pushMode = useCallback((next: PaletteMode) => {
    setModeStack((prev) => [...prev, next])
  }, [])

  const popMode = useCallback(() => {
    setModeStack((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.slice(0, -1)
      const popped = prev[prev.length - 1]
      if (popped === "confirm") {
        setPendingCommand(null)
        setConfirmPayload(null)
      }
      if (popped === "entity") setEntityCommand(null)
      if (popped === "editor") setEditorCommand(null)
      if (popped === "search-results") {
        setSearchResultsState(null)
        setSearchResultsCommand(null)
      }
      return next
    })
  }, [])

  const openEditor = useCallback(
    (command: CommandDef) => {
      setEditorCommand(command)
      pushMode("editor")
    },
    [pushMode],
  )

  const openEntity = useCallback(
    (command: CommandDef) => {
      setEntityCommand(command)
      pushMode("entity")
    },
    [pushMode],
  )

  const openConfirm = useCallback(
    (command: CommandDef, payload?: unknown) => {
      setPendingCommand(command)
      setConfirmPayload(payload ?? null)
      pushMode("confirm")
    },
    [pushMode],
  )

  const openSearchResults = useCallback(
    (state: SearchResultsState, command: CommandDef) => {
      setSearchResultsState(state)
      setSearchResultsCommand(command)
      pushMode("search-results")
    },
    [pushMode],
  )

  const getRootQuery = useCallback(() => rootQueryRef.current, [])

  const value = useMemo<CommandPaletteContextValue>(
    () => ({
      open,
      setOpen,
      toggle,
      close,
      pushMode,
      popMode,
      openEditor,
      openEntity,
      openConfirm,
      openSearchResults,
      getRootQuery,
      confirmPayload,
      searchResultsState,
      searchResultsCommand,
      mode,
      modeStack,
      pendingCommand,
      setPendingCommand,
      entityCommand,
      setEntityCommand,
      editorCommand,
      setEditorCommand,
      rootQueryRef,
    }),
    [
      close,
      confirmPayload,
      editorCommand,
      entityCommand,
      getRootQuery,
      mode,
      modeStack,
      open,
      setOpen,
      openConfirm,
      openEditor,
      openEntity,
      openSearchResults,
      pendingCommand,
      popMode,
      pushMode,
      searchResultsCommand,
      searchResultsState,
      toggle,
    ],
  )

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
    </CommandPaletteContext.Provider>
  )
}

export function useCommandPaletteContext(): CommandPaletteContextValue {
  const context = useContext(CommandPaletteContext)
  if (!context) {
    throw new Error(
      "useCommandPaletteContext must be used within CommandPaletteProvider",
    )
  }
  return context
}
