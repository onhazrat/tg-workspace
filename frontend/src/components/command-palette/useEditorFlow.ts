import { useEffect, useRef, useState } from "react"
import { getChainedEditorField } from "@/lib/commands/extended-commands"
import { applyEditor } from "@/lib/commands/palette-editor-apply"
import type {
  CommandContext,
  CommandDef,
  SearchResultsState,
} from "@/lib/commands/types"
import type { Channel } from "@/types"

interface UseEditorFlowOptions {
  editorCommand: CommandDef | null
  context: CommandContext
  entityPayload: unknown
  openSearchResults: (state: SearchResultsState, command: CommandDef) => void
  close: () => void
  recordRecent: (commandId: string) => void
  /** Clears the search-results filter before showing fresh results. */
  onSearchResultsOpened: () => void
}

/** State and behavior for the editor sub-view, including Apply side effects. */
export function useEditorFlow({
  editorCommand,
  context,
  entityPayload,
  openSearchResults,
  close,
  recordRecent,
  onSearchResultsOpened,
}: UseEditorFlowOptions) {
  const [editorValue, setEditorValue] = useState("")
  const [isApplying, setIsApplying] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
      entityPayload as Channel | undefined,
    )
    if (chained) {
      setEditorValue(chained.getValue())
    }
  }, [editorCommand?.id, entityPayload])

  const resetEditor = () => {
    setEditorValue("")
    setIsApplying(false)
  }

  const clearAndRefocus = () => {
    setEditorValue("")
    requestAnimationFrame(() => {
      ;(inputRef.current ?? textareaRef.current)?.focus()
    })
  }

  const handleApply = async () => {
    if (!editorCommand || isApplying) return
    await applyEditor({
      command: editorCommand,
      context,
      value: editorValue,
      setApplying: setIsApplying,
      openSearchResults,
      onSearchResultsOpened,
      recordRecent,
      close,
      onStayOpen: clearAndRefocus,
    })
  }

  return {
    editorValue,
    setEditorValue,
    isApplying,
    inputRef,
    textareaRef,
    handleApply,
    resetEditor,
    viewProps: {
      value: editorValue,
      onValueChange: setEditorValue,
      isApplying,
      onApply: handleApply,
      inputRef,
      textareaRef,
    },
  }
}
