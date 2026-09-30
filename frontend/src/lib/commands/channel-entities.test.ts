/**
 * The selection edits and the action limit in the palette (CTB-04): each runs
 * against the Channels tab's Shown Channels, and each is disabled with a
 * reason when it would change nothing.
 */
import { describe, expect, test } from "bun:test"
import type { ActionLimit } from "@/lib/channels/selection-regions"
import type { CommandContext } from "@/lib/commands/types"
import { buildChannelEntityCommands } from "./channel-entities"

const commands = buildChannelEntityCommands()
const command = (label: string) => {
  const found = commands.find((c) => c.label === label)
  if (!found) throw new Error(`no command ${label}`)
  return found
}

function ctx(over: Partial<CommandContext> = {}, limit: ActionLimit = "shown") {
  const state = { selection: new Set(["h1", "b1"]), limit }
  const context = {
    selectedChannels: state.selection,
    shownChannelNames: ["b1", "f1"],
    setSelectedChannels: (next: Set<string>) => {
      state.selection = next
    },
    settings: {
      channelActionLimit: limit,
      setChannelActionLimit: (next: ActionLimit) => {
        state.limit = next
      },
    },
    ...over,
  } as unknown as CommandContext
  return { context, state }
}

describe("the selection edits", () => {
  test.each([
    ["Selection: Add shown", ["h1", "b1", "f1"]],
    ["Selection: Remove shown", ["h1"]],
    ["Selection: Keep only shown", ["b1"]],
    ["Selection: Invert shown", ["h1", "f1"]],
    ["Selection: Select only shown", ["b1", "f1"]],
  ])("%s edits the selection against the Shown Channels", (label, after) => {
    const { context, state } = ctx()
    expect(command(label).disabled?.(context)).toEqual({ disabled: false })
    command(label).run(context)
    expect([...state.selection].sort()).toEqual([...after].sort())
  })

  test("an edit that would change nothing says so", () => {
    const { context } = ctx({ selectedChannels: new Set(["b1"]) })
    expect(command("Selection: Keep only shown").disabled?.(context)).toEqual({
      disabled: true,
      reason: "Would change nothing",
    })
  })

  test("off the Channels tab there are no Shown Channels to edit against", () => {
    const { context } = ctx({ shownChannelNames: null })
    expect(command("Selection: Add shown").disabled?.(context)).toEqual({
      disabled: true,
      reason: "Open the Channels tab",
    })
  })
})

describe("the action limit", () => {
  test("switches, and the one already set is disabled", () => {
    const { context, state } = ctx({}, "shown")
    expect(command("Actions apply to: Shown").disabled?.(context)).toEqual({
      disabled: true,
      reason: "Already on Shown",
    })
    expect(command("Actions apply to: All").disabled?.(context)).toEqual({
      disabled: false,
    })
    command("Actions apply to: All").run(context)
    expect(state.limit).toBe("all")
  })
})
