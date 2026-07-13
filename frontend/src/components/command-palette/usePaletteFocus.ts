import { type RefObject, useEffect } from "react"
import type { PaletteMode, SearchResultsKind } from "@/lib/commands/types"

interface UsePaletteFocusOptions {
  open: boolean
  mode: PaletteMode
  editorCommandId: string | undefined
  entityCommandId: string | undefined
  searchResultsKind: SearchResultsKind | undefined
  commandInputRef: RefObject<HTMLInputElement | null>
  entityInputRef: RefObject<HTMLInputElement | null>
  searchResultsInputRef: RefObject<HTMLInputElement | null>
  editorInputRef: RefObject<HTMLInputElement | null>
  editorTextareaRef: RefObject<HTMLTextAreaElement | null>
}

/**
 * Sub-view inputs mount after mode transitions; Radix Dialog keeps focus on
 * the dialog shell unless we explicitly move it to the search field.
 */
export function usePaletteFocus({
  open,
  mode,
  editorCommandId,
  entityCommandId,
  searchResultsKind,
  commandInputRef,
  entityInputRef,
  searchResultsInputRef,
  editorInputRef,
  editorTextareaRef,
}: UsePaletteFocusOptions) {
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
  }, [editorCommandId, entityCommandId, mode, open, searchResultsKind])
}
