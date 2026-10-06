/**
 * The Directory's search box (DIR-04): what is typed reaches the view once
 * typing stops, and a blank box at once, so clearing never waits (the read
 * it supersedes is aborted by `useDirectory`'s query). The sort before
 * Relevance is kept here to go back to; a reload while searching goes back
 * to the default instead.
 */
import { useEffect, useRef, useState } from "react"
import {
  DEFAULT_VIEW,
  type DirectoryView,
  searchPatch,
} from "@/lib/directory/directory-view"
import { useDebouncedValue } from "./useDebouncedValue"

/** How long the box waits for typing to stop before the view takes it. */
export const SEARCH_DEBOUNCE_MS = 300

export function useDirectorySearchBox(
  view: DirectoryView,
  patch: (next: Partial<DirectoryView>) => void,
) {
  const [draft, setDraft] = useState(view.search)
  const previous = useRef({
    sort: DEFAULT_VIEW.sort,
    descending: DEFAULT_VIEW.descending,
  })
  if (view.sort !== "relevance")
    previous.current = { sort: view.sort, descending: view.descending }
  const commit = (text: string) =>
    patch(searchPatch(view, text, previous.current))

  // The view moved on its own (a link, Back, the chip): the box follows.
  useEffect(() => setDraft(view.search), [view.search])
  const settled = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS)
  // On `draft` too: a box cleared and retyped to the last settled text
  // within the wait never changes `settled`.
  useEffect(() => {
    if (settled === draft && settled !== view.search) commit(settled)
  }, [settled, draft])

  const setSearch = (text: string) => {
    setDraft(text)
    if (!text.trim() && view.search) commit(text)
  }
  /** Clear all: the search and the filter in one navigation. */
  const clearAll = () => {
    setDraft("")
    patch({ ...searchPatch(view, "", previous.current), filter: "" })
  }
  return { draft, setSearch, clearAll }
}
