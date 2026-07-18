import { useEffect, useRef, useState } from "react"
import { normalizeChannelHandle } from "@/lib/commands/channel-ops"
import {
  getChainedEditorApply,
  getChainedEditorField,
} from "@/lib/commands/extended-commands"
import { buildSearchResultsState } from "@/lib/commands/palette-search"
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

  const handleApply = async () => {
    if (!editorCommand || isApplying) return

    if (
      editorCommand.id === "add-tag-channel" ||
      editorCommand.id === "edit-channel-start-id"
    ) {
      setIsApplying(true)
      try {
        await getChainedEditorApply(editorCommand.id, context, editorValue)
        recordRecent(editorCommand.id)
        close()
      } finally {
        setIsApplying(false)
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

    setIsApplying(true)
    try {
      await editorCommand.editorField.apply(context, editorValue)

      const results = await buildSearchResultsState(
        editorCommand,
        context,
        editorValue,
      )
      if (results) {
        openSearchResults(results, editorCommand)
        onSearchResultsOpened()
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
        ;(inputRef.current ?? textareaRef.current)?.focus()
      })
    } finally {
      setIsApplying(false)
    }
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
