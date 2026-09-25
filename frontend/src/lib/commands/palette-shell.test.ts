import { describe, expect, test } from "bun:test"
import {
  activePalettePanel,
  closeButtonTabIndex,
  commandEnterTarget,
  confirmStaysInEntity,
  editorEnterApplies,
  entityEnterPickId,
  isBackspaceBack,
  type PalettePanelInput,
  pickRecordedOnBack,
  selectCommandAction,
} from "@/lib/commands/palette-shell"
import type {
  CommandContext,
  CommandDef,
  SearchResultsState,
} from "@/lib/commands/types"
import type { Channel } from "@/types"

function command(id: string, overrides: Partial<CommandDef> = {}): CommandDef {
  return {
    id,
    kind: "action",
    label: id,
    keywords: [],
    group: "Test",
    run: () => {},
    ...overrides,
  }
}

const context = {} as CommandContext
const key = (overrides: Partial<Record<string, unknown>> = {}) => ({
  key: "Enter",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...overrides,
})

describe("isBackspaceBack", () => {
  test("goes back on Backspace in an empty search below the root", () => {
    expect(isBackspaceBack("Backspace", "", 2)).toBe(true)
    expect(isBackspaceBack("Backspace", "   ", 3)).toBe(true)
  })

  test("stays on another key, a typed search, or the root", () => {
    expect(isBackspaceBack("Delete", "", 2)).toBe(false)
    expect(isBackspaceBack("Backspace", "a", 2)).toBe(false)
    expect(isBackspaceBack("Backspace", "", 1)).toBe(false)
  })
})

describe("editorEnterApplies", () => {
  test("Enter applies a single-line editor", () => {
    expect(editorEnterApplies(key(), false, false)).toBe(true)
  })

  test("a textarea needs Cmd or Ctrl", () => {
    expect(editorEnterApplies(key(), true, false)).toBe(false)
    expect(editorEnterApplies(key({ metaKey: true }), true, false)).toBe(true)
    expect(editorEnterApplies(key({ ctrlKey: true }), true, false)).toBe(true)
  })

  test("nothing applies while applying or on another key", () => {
    expect(editorEnterApplies(key(), false, true)).toBe(false)
    expect(editorEnterApplies(key({ key: "a" }), false, false)).toBe(false)
  })
})

describe("commandEnterTarget", () => {
  const a = command("a")
  const b = command("b")
  const c = command("c")

  test("prefers the selected command from the full list", () => {
    expect(commandEnterTarget(key(), [a, b], [c], "b")).toBe(b)
  })

  test("falls back to the selected ranked command, then the top ranked", () => {
    expect(commandEnterTarget(key(), [a], [b, c], "c")).toBe(c)
    expect(commandEnterTarget(key(), [a], [b, c], "missing")).toBe(b)
  })

  test("nothing without Enter or ranked commands", () => {
    expect(commandEnterTarget(key({ key: "x" }), [a], [a], "a")).toBeUndefined()
    expect(commandEnterTarget(key(), [], [], "a")).toBeUndefined()
  })

  test("Shift+Enter runs nothing unless Cmd or Ctrl is held too", () => {
    expect(
      commandEnterTarget(key({ shiftKey: true }), [a], [a], "a"),
    ).toBeUndefined()
    expect(
      commandEnterTarget(key({ shiftKey: true, metaKey: true }), [a], [a], "a"),
    ).toBe(a)
    expect(
      commandEnterTarget(key({ shiftKey: true, ctrlKey: true }), [a], [a], "a"),
    ).toBe(a)
  })
})

describe("entityEnterPickId", () => {
  const channels: Channel[] = [
    { id: "1", name: "alpha" },
    { id: "2", name: "beta" },
  ]
  const entity = { entityQuery: "bet", candidates: channels, selectedId: "" }
  const flowCommand = command("pick", { entityFlow: "select-channel" })

  test("Enter resolves the pick for the entity command's flow", () => {
    expect(entityEnterPickId("Enter", flowCommand, entity)).toBe("beta")
  })

  test("nothing on another key, without a command or without a flow", () => {
    expect(entityEnterPickId("Tab", flowCommand, entity)).toBe("")
    expect(entityEnterPickId("Enter", null, entity)).toBe("")
    expect(entityEnterPickId("Enter", command("plain"), entity)).toBe("")
  })
})

describe("selectCommandAction", () => {
  test("a disabled command does nothing, whatever its kind", () => {
    const disabled = command("x", {
      kind: "editor",
      disabled: () => ({ disabled: true, reason: "no" }),
    })
    expect(selectCommandAction(disabled, context)).toBe("disabled")
  })

  test("the disabled check receives the context", () => {
    let seen: unknown = null
    selectCommandAction(
      command("x", {
        disabled: (ctx) => {
          seen = ctx
          return { disabled: false }
        },
      }),
      context,
    )
    expect(seen).toBe(context)
  })

  test("routes by kind, then confirmation, then runs", () => {
    const enabled = { disabled: () => ({ disabled: false }) }
    expect(
      selectCommandAction(
        command("e", { kind: "editor", ...enabled }),
        context,
      ),
    ).toBe("editor")
    expect(
      selectCommandAction(
        command("n", { kind: "entity-root", entityFlow: "select-channel" }),
        context,
      ),
    ).toBe("entity")
    expect(
      selectCommandAction(command("s", { kind: "assistant" }), context),
    ).toBe("assistant")
    expect(
      selectCommandAction(
        command("c", { requiresConfirmation: true }),
        context,
      ),
    ).toBe("confirm")
    expect(selectCommandAction(command("r"), context)).toBe("run")
  })

  test("an entity root without a flow falls through to run", () => {
    expect(
      selectCommandAction(command("n", { kind: "entity-root" }), context),
    ).toBe("run")
  })
})

describe("pickRecordedOnBack", () => {
  const staying = command("fix", { closeOnPick: false })

  test("leaving an entity list that stays open records its command", () => {
    expect(pickRecordedOnBack("entity", staying)).toBe(staying)
  })

  test("nothing for another mode or a list that closes on pick", () => {
    expect(pickRecordedOnBack("editor", staying)).toBeNull()
    expect(pickRecordedOnBack("entity", command("x"))).toBeNull()
    expect(
      pickRecordedOnBack("entity", command("x", { closeOnPick: true })),
    ).toBeNull()
    expect(pickRecordedOnBack("entity", null)).toBeNull()
  })
})

describe("confirmStaysInEntity", () => {
  const staying = command("fix", { closeOnPick: false })

  test("only the staying entity command's own confirm returns to it", () => {
    expect(confirmStaysInEntity(staying, staying)).toBe(true)
    expect(confirmStaysInEntity(command("other"), staying)).toBe(false)
    expect(confirmStaysInEntity(command("fix"), command("fix"))).toBe(false)
    expect(confirmStaysInEntity(staying, null)).toBe(false)
  })
})

describe("closeButtonTabIndex", () => {
  test("list modes take the close button out of the tab order", () => {
    expect(closeButtonTabIndex("commands")).toBe(-1)
    expect(closeButtonTabIndex("entity")).toBe(-1)
    expect(closeButtonTabIndex("search-results")).toBe(-1)
    expect(closeButtonTabIndex("editor")).toBeUndefined()
    expect(closeButtonTabIndex("confirm")).toBeUndefined()
    expect(closeButtonTabIndex("assistant")).toBeUndefined()
  })
})

describe("activePalettePanel", () => {
  const empty: PalettePanelInput = {
    mode: "commands",
    pendingCommand: null,
    editorCommand: null,
    entityCommand: null,
    entityPayload: undefined,
    searchResultsState: null,
    searchResultsCommand: null,
  }
  const state: SearchResultsState = {
    kind: "posts",
    query: "q",
    items: [],
    totalCount: 0,
  }
  const field = {
    id: "f",
    label: "Field label",
    type: "text" as const,
    getValue: () => "",
    apply: () => {},
  }

  test("the root list and the assistant always show", () => {
    expect(activePalettePanel(empty)).toEqual({ kind: "commands" })
    expect(activePalettePanel({ ...empty, mode: "assistant" })).toEqual({
      kind: "assistant",
    })
  })

  test("confirm needs a pending command", () => {
    const pending = command("p")
    expect(activePalettePanel({ ...empty, mode: "confirm" })).toBeNull()
    expect(
      activePalettePanel({
        ...empty,
        mode: "confirm",
        pendingCommand: pending,
      }),
    ).toEqual({ kind: "confirm", command: pending })
  })

  test("entity needs an entity command", () => {
    const entityCommand = command("n")
    expect(activePalettePanel({ ...empty, mode: "entity" })).toBeNull()
    expect(
      activePalettePanel({ ...empty, mode: "entity", entityCommand }),
    ).toEqual({ kind: "entity", command: entityCommand })
  })

  test("search results need both the state and the command", () => {
    const searchResultsCommand = command("s")
    const mode = "search-results" as const
    expect(
      activePalettePanel({ ...empty, mode, searchResultsState: state }),
    ).toBeNull()
    expect(
      activePalettePanel({ ...empty, mode, searchResultsCommand }),
    ).toBeNull()
    expect(
      activePalettePanel({
        ...empty,
        mode,
        searchResultsState: state,
        searchResultsCommand,
      }),
    ).toEqual({ kind: "search-results", command: searchResultsCommand, state })
  })

  test("an editor needs a command with a field or a chained field", () => {
    expect(activePalettePanel({ ...empty, mode: "editor" })).toBeNull()
    expect(
      activePalettePanel({
        ...empty,
        mode: "editor",
        editorCommand: command("no-field"),
      }),
    ).toBeNull()

    const withField = command("set", { editorField: field })
    expect(
      activePalettePanel({
        ...empty,
        mode: "editor",
        editorCommand: withField,
      }),
    ).toEqual({ kind: "editor", command: withField, fieldLabel: "Field label" })
  })

  test("a chained editor labels itself from the picked channel", () => {
    const chained = command("edit-channel-start-id")
    expect(
      activePalettePanel({
        ...empty,
        mode: "editor",
        editorCommand: chained,
        entityPayload: { id: "1", name: "news" },
      }),
    ).toEqual({
      kind: "editor",
      command: chained,
      fieldLabel: "Start message ID for @news",
    })
  })

  test("the chained label wins over the field's own", () => {
    const both = command("add-tag-channel", { editorField: field })
    expect(
      activePalettePanel({ ...empty, mode: "editor", editorCommand: both }),
    ).toEqual({ kind: "editor", command: both, fieldLabel: "Tag name" })
  })
})
