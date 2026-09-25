import { describe, expect, test } from "bun:test"
import {
  buildExtendedCommands,
  getChainedEditorApply,
  getChainedEditorField,
  runChainedChannelEntityPick,
} from "@/lib/commands/extended-commands"
import type { CommandContext, EntityFlowType } from "@/lib/commands/types"
import type { Channel } from "@/types"

const channel: Channel = { id: "c1", name: "news", startId: 42 }

function paletteContext(entityPayload?: unknown) {
  const payloads: unknown[] = []
  const ctx = {
    palette: {
      entityPayload,
      setEntityPayload: (payload: unknown) => payloads.push(payload),
    },
  } as unknown as CommandContext
  return { ctx, payloads }
}

describe("buildExtendedCommands", () => {
  const commands = buildExtendedCommands()
  const ids = commands.map((command) => command.id)

  test("every id is unique", () => {
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("adds one command per date preset, forwarded option and server job", () => {
    expect(ids).toContain("set-posts-date-range-24h")
    expect(ids).toContain("set-posts-date-range-30d")
    expect(ids).toContain("set-forwarded-filter-original")
    expect(ids).toContain("set-forwarded-filter-forwarded")
    expect(ids).toContain("trigger-job-auto_sync")
    expect(ids).toContain("trigger-job-translation_batch")
    const job = commands.find(
      (command) => command.id === "trigger-job-retention",
    )
    expect(job?.label).toBe("Trigger Job Now → Retention")
    expect(job?.keywords).toContain("retention")
  })

  test("adds media filters but skips the all option", () => {
    const media = ids.filter((id) => id.startsWith("set-media-filter-"))
    expect(media.length).toBeGreaterThan(0)
    expect(media).not.toContain("set-media-filter-all")
  })
})

describe("runChainedChannelEntityPick", () => {
  const noEffects = {
    refreshChannelMetadata: async () => {
      throw new Error("unexpected refresh")
    },
    copyChannelTelegramChatId: async () => {
      throw new Error("unexpected copy")
    },
  }

  test.each([
    ["reset-sync-channel", "confirm", false],
    ["fix-partial-history-channel", "confirm", false],
    ["add-tag-channel", "editor", true],
    ["remove-tag-channel", "tag-pick", true],
    ["edit-start-id-channel", "editor", true],
    ["freeze-channel", null, false],
  ] as const)("%s answers %s", async (flow, expected, storesPayload) => {
    const { ctx, payloads } = paletteContext()
    const result = await runChainedChannelEntityPick(
      flow as EntityFlowType,
      channel,
      ctx,
      noEffects,
    )
    expect(result).toBe(expected)
    expect(payloads).toEqual(storesPayload ? [channel] : [])
  })

  test("refresh-metadata refreshes the picked channel and is done", async () => {
    const { ctx, payloads } = paletteContext()
    const calls: unknown[] = []
    const result = await runChainedChannelEntityPick(
      "refresh-metadata-channel",
      channel,
      ctx,
      {
        ...noEffects,
        refreshChannelMetadata: async (picked, context) => {
          calls.push([picked, context])
        },
      },
    )
    expect(result).toBe("done")
    expect(calls).toEqual([[channel, ctx]])
    expect(payloads).toEqual([])
  })

  test("copy-telegram-chat-id copies the picked channel and is done", async () => {
    const { ctx } = paletteContext()
    const calls: Channel[] = []
    const result = await runChainedChannelEntityPick(
      "copy-channel-telegram-chat-id",
      channel,
      ctx,
      {
        ...noEffects,
        copyChannelTelegramChatId: async (picked) => {
          calls.push(picked)
        },
      },
    )
    expect(result).toBe("done")
    expect(calls).toEqual([channel])
  })
})

describe("getChainedEditorApply", () => {
  function recordingEffects() {
    const calls: unknown[] = []
    return {
      calls,
      effects: {
        addTagToChannel: async (...args: unknown[]) => {
          calls.push(["tag", ...args])
        },
        updateChannelStartId: async (...args: unknown[]) => {
          calls.push(["start", ...args])
        },
      },
    }
  }

  test("adds the tag to the chained channel", async () => {
    const { ctx } = paletteContext(channel)
    const { calls, effects } = recordingEffects()
    await getChainedEditorApply("add-tag-channel", ctx, "ai", effects)
    expect(calls).toEqual([["tag", channel, "ai", ctx]])
  })

  test("updates the start id of the chained channel", async () => {
    const { ctx } = paletteContext(channel)
    const { calls, effects } = recordingEffects()
    await getChainedEditorApply("edit-channel-start-id", ctx, "7", effects)
    expect(calls).toEqual([["start", channel, "7", ctx]])
  })

  test("does nothing without a chained channel or for another command", async () => {
    const { calls, effects } = recordingEffects()
    const empty = paletteContext().ctx
    await getChainedEditorApply("add-tag-channel", empty, "ai", effects)
    await getChainedEditorApply("edit-channel-start-id", empty, "7", effects)
    await getChainedEditorApply(
      "add-channel",
      paletteContext(channel).ctx,
      "x",
      effects,
    )
    expect(calls).toEqual([])
  })
})

describe("getChainedEditorField", () => {
  test("the tag editor starts empty", () => {
    const field = getChainedEditorField("add-tag-channel", channel)
    expect(field?.label).toBe("Tag name")
    expect(field?.getValue()).toBe("")
  })

  test("the start id editor names the channel and starts at its start id", () => {
    const field = getChainedEditorField("edit-channel-start-id", channel)
    expect(field?.label).toBe("Start message ID for @news")
    expect(field?.getValue()).toBe("42")
  })

  test("the start id editor falls back when there is no channel or start id", () => {
    const field = getChainedEditorField("edit-channel-start-id", undefined)
    expect(field?.label).toBe("Start message ID for @channel")
    expect(field?.getValue()).toBe("")
  })

  test("other commands have no chained field", () => {
    expect(getChainedEditorField("add-channel", channel)).toBeNull()
  })
})
