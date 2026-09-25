import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, renderHook } from "@testing-library/react"

import type { PaletteMode } from "@/lib/commands/types"
import { usePaletteFocus } from "./usePaletteFocus"

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

const input = () => {
  const el = document.createElement("input")
  document.body.appendChild(el)
  return el
}

/** Runs the hook and waits one animation frame, where the focus happens. */
async function focusedAfter(
  mode: PaletteMode,
  { open = true, editorInput = true } = {},
) {
  const refs = {
    commandInputRef: { current: input() },
    entityInputRef: { current: input() },
    searchResultsInputRef: { current: input() },
    editorInputRef: { current: editorInput ? input() : null },
    editorTextareaRef: {
      current: document.body.appendChild(document.createElement("textarea")),
    },
  }
  renderHook(() =>
    usePaletteFocus({
      open,
      mode,
      editorCommandId: undefined,
      entityCommandId: undefined,
      searchResultsKind: undefined,
      ...refs,
    }),
  )
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  const active = document.activeElement
  const name = Object.entries(refs).find(([, ref]) => ref.current === active)
  return name?.[0] ?? null
}

describe("usePaletteFocus", () => {
  test("moves focus to the input of the sub-view on screen", async () => {
    expect(await focusedAfter("commands")).toBe("commandInputRef")
    expect(await focusedAfter("entity")).toBe("entityInputRef")
    expect(await focusedAfter("search-results")).toBe("searchResultsInputRef")
    expect(await focusedAfter("editor")).toBe("editorInputRef")
  })

  test("falls back to the textarea for an editor without an input", async () => {
    expect(await focusedAfter("editor", { editorInput: false })).toBe(
      "editorTextareaRef",
    )
  })

  test("leaves focus alone while closed or in a view with no input", async () => {
    expect(await focusedAfter("commands", { open: false })).toBeNull()
    // Confirm focuses its own Cancel button; the palette must not steal it.
    expect(await focusedAfter("confirm")).toBeNull()
  })
})
