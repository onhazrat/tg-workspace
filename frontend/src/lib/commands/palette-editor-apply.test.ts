import { describe, expect, test } from "bun:test"
import {
  applyEditor,
  type EditorApplyDeps,
  editorApplyStep,
} from "@/lib/commands/palette-editor-apply"
import type {
  CommandContext,
  CommandDef,
  SearchResultsState,
} from "@/lib/commands/types"

const context = { marker: "ctx" } as unknown as CommandContext
const results: SearchResultsState = {
  kind: "posts",
  query: "q",
  items: [],
  totalCount: 0,
}

function fieldCommand(overrides: Partial<CommandDef> = {}): CommandDef {
  return {
    id: "set-thing",
    kind: "editor",
    label: "Set thing",
    keywords: [],
    group: "Test",
    editorField: {
      id: "thing",
      label: "Thing",
      type: "text",
      getValue: () => "",
      apply: () => {},
    },
    run: () => {},
    ...overrides,
  }
}

/** Deps that log every call in order, so a test reads the whole Apply. */
function harness(
  command: CommandDef,
  value = "value",
  overrides: Partial<EditorApplyDeps> = {},
) {
  const log: string[] = []
  const deps: EditorApplyDeps = {
    command,
    context,
    value,
    setApplying: (applying) => log.push(`applying:${applying}`),
    openSearchResults: (state, cmd) =>
      log.push(`open-results:${state.kind}:${cmd.id}`),
    onSearchResultsOpened: () => log.push("results-opened"),
    recordRecent: (id) => log.push(`recent:${id}`),
    close: () => log.push("close"),
    onStayOpen: () => log.push("stay-open"),
    applyChained: async (id, ctx, val) => {
      expect(ctx).toBe(context)
      log.push(`chained:${id}:${val}`)
    },
    buildResults: async () => null,
    ...overrides,
  }
  return { deps, log }
}

describe("editorApplyStep", () => {
  test("the chained channel editors apply without an editor field", () => {
    for (const id of ["add-tag-channel", "edit-channel-start-id"]) {
      expect(
        editorApplyStep(fieldCommand({ id, editorField: undefined }), ""),
      ).not.toBeNull()
    }
  })

  test("a command without an editor field has nothing to apply", () => {
    expect(
      editorApplyStep(fieldCommand({ editorField: undefined }), "x"),
    ).toBeNull()
  })

  test("add-channel needs a handle unless it allows an empty apply", () => {
    const add = fieldCommand({ id: "add-channel" })
    expect(editorApplyStep(add, "   ")).toBeNull()
    expect(editorApplyStep(add, "@news")).not.toBeNull()
    expect(
      editorApplyStep({ ...add, allowEmptyApply: true }, ""),
    ).not.toBeNull()
  })

  test("an empty value is fine for any other field", () => {
    expect(editorApplyStep(fieldCommand(), "")).not.toBeNull()
  })
})

describe("applyEditor", () => {
  test("a chained editor applies to the channel, records it, then closes", async () => {
    const { deps, log } = harness(
      fieldCommand({ id: "add-tag-channel", editorField: undefined }),
      "ai",
    )
    await applyEditor(deps)
    expect(log).toEqual([
      "applying:true",
      "chained:add-tag-channel:ai",
      "recent:add-tag-channel",
      "close",
      "applying:false",
    ])
  })

  test("a no-op Apply never raises the applying flag", async () => {
    const { deps, log } = harness(fieldCommand({ editorField: undefined }))
    await applyEditor(deps)
    expect(log).toEqual([])
  })

  test("a field editor applies the value, records it and closes", async () => {
    const applied: unknown[] = []
    const command = fieldCommand()
    if (command.editorField)
      command.editorField.apply = (ctx, value) => {
        applied.push([ctx, value])
      }
    const { deps, log } = harness(command, "42")
    await applyEditor(deps)
    expect(applied).toEqual([[context, "42"]])
    expect(log).toEqual([
      "applying:true",
      "recent:set-thing",
      "close",
      "applying:false",
    ])
  })

  test("a search editor opens its results instead of closing", async () => {
    const { deps, log } = harness(fieldCommand(), "q", {
      buildResults: async (cmd, ctx, value) => {
        expect([cmd.id, ctx, value]).toEqual(["set-thing", context, "q"])
        return results
      },
    })
    await applyEditor(deps)
    expect(log).toEqual([
      "applying:true",
      "open-results:posts:set-thing",
      "results-opened",
      "recent:set-thing",
      "applying:false",
    ])
  })

  test("closeOnApply false keeps the editor open", async () => {
    const { deps, log } = harness(fieldCommand({ closeOnApply: false }))
    await applyEditor(deps)
    expect(log).toEqual([
      "applying:true",
      "recent:set-thing",
      "stay-open",
      "applying:false",
    ])
  })

  test("a failed apply still lowers the flag and records nothing", async () => {
    const command = fieldCommand()
    if (command.editorField)
      command.editorField.apply = () => {
        throw new Error("boom")
      }
    const { deps, log } = harness(command)
    await expect(applyEditor(deps)).rejects.toThrow("boom")
    expect(log).toEqual(["applying:true", "applying:false"])
  })
})
