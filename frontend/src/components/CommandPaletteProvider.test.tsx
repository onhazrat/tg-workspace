import { describe, expect, test } from "bun:test"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"

import type { CommandDef, SearchResultsState } from "@/lib/commands/types"
import {
  CommandPaletteProvider,
  useCommandPaletteContext,
} from "./CommandPaletteProvider"

const command = { id: "cmd" } as CommandDef

function palette() {
  return renderHook(() => useCommandPaletteContext(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <CommandPaletteProvider>{children}</CommandPaletteProvider>
    ),
  }).result
}

describe("CommandPaletteProvider popMode", () => {
  test("never pops the root commands view", () => {
    const result = palette()
    act(() => result.current.popMode())
    expect(result.current.modeStack).toEqual(["commands"])
  })

  test("popping a view clears only the state that view owned", () => {
    const result = palette()
    act(() => result.current.openEntity(command))
    act(() => result.current.setEntityPayload("row"))
    act(() => result.current.openEditor(command))
    act(() => result.current.openConfirm(command, { id: 1 }))
    act(() =>
      result.current.openSearchResults({} as SearchResultsState, command),
    )
    expect(result.current.mode).toBe("search-results")

    act(() => result.current.popMode())
    expect(result.current.searchResultsState).toBeNull()
    expect(result.current.searchResultsCommand).toBeNull()
    expect(result.current.pendingCommand).toBe(command)

    act(() => result.current.popMode())
    expect(result.current.pendingCommand).toBeNull()
    expect(result.current.confirmPayload).toBeNull()
    expect(result.current.editorCommand).toBe(command)

    act(() => result.current.popMode())
    expect(result.current.editorCommand).toBeNull()
    expect(result.current.entityCommand).toBe(command)

    act(() => result.current.popMode())
    expect(result.current.entityCommand).toBeNull()
    expect(result.current.entityPayload).toBeNull()
    expect(result.current.modeStack).toEqual(["commands"])
  })
})
