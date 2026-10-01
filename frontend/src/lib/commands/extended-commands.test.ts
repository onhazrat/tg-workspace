import { describe, expect, spyOn, test } from "bun:test"
import { toast } from "sonner"

import {
  buildExtendedCommands,
  getChainedEditorApply,
  getChainedEditorField,
  runChainedChannelEntityPick,
} from "@/lib/commands/extended-commands"
import type { CommandContext, EntityFlowType } from "@/lib/commands/types"
import {
  addPostFunnel,
  emptyPostFilter,
  printPostFilter,
} from "@/lib/posts/post-filter"
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

describe("the post-filter commands add to the Post filter (PTR-03)", () => {
  const commands = buildExtendedCommands()
  const run = (id: string, ctx: CommandContext) =>
    commands.find((command) => command.id === id)?.run(ctx)

  function filterContext(over: Partial<CommandContext> = {}) {
    const writes: Record<string, unknown> = {}
    const ctx = {
      postSearch: "",
      postFilter: emptyPostFilter(),
      postSortOrder: "newest",
      groupByChannel: false,
      setPostFilter: (
        value: Parameters<CommandContext["setPostFilter"]>[0],
      ) => {
        writes.filter = printPostFilter(value)
      },
      setPostSortOrder: (value: unknown) => {
        writes.order = value
      },
      setGroupByChannel: (value: unknown) => {
        writes.grouped = value
      },
      handleFilterPosts: async () => {},
      ...over,
    } as unknown as CommandContext
    return { ctx, writes }
  }

  test("a media command adds its Condition, joined with OR, and takes it out", async () => {
    const toastSpy = spyOn(toast, "success").mockImplementation(() => "")
    const photo = addPostFunnel(emptyPostFilter(), "media", "photo")
    const adding = filterContext({ postFilter: photo })
    await run("set-media-filter-video", adding.ctx)
    expect(adding.writes.filter).toBe("(media:photo or media:video)")

    const removing = filterContext({
      postFilter: addPostFunnel(photo, "media", "video"),
    })
    await run("set-media-filter-photo", removing.ctx)
    expect(removing.writes.filter).toBe("media:video")
    toastSpy.mockRestore()
  })

  test("a Type command adds its Condition beside what the filter has", async () => {
    const toastSpy = spyOn(toast, "success").mockImplementation(() => "")
    const persian = addPostFunnel(emptyPostFilter(), "language", "fa")
    const typed = filterContext({ postFilter: persian })
    await run("set-forwarded-filter-original", typed.ctx)
    expect(typed.writes.filter).toBe("lang:fa and type:original")
    expect(
      commands
        .find((c) => c.id === "set-forwarded-filter-original")
        ?.getBadge?.(typed.ctx),
    ).toBeNull()
    toastSpy.mockRestore()
  })

  test("both orders, and grouping as its own toggle", async () => {
    const toastSpy = spyOn(toast, "success").mockImplementation(() => "")
    const order = filterContext()
    await run("set-post-order-oldest", order.ctx)
    expect(order.writes.order).toBe("oldest")

    const grouped = filterContext({ groupByChannel: true })
    await run("toggle-group-posts-by-channel", grouped.ctx)
    expect(grouped.writes.grouped).toBe(false)
    toastSpy.mockRestore()
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

/**
 * Pasting an external AI response completes a summary that "Copy Summary
 * Prompt" opened. The open one is preferred; otherwise any pending one.
 */
describe("paste-external-summary", () => {
  const apply = buildExtendedCommands().find(
    (command) => command.id === "paste-external-summary",
  )?.editorField?.apply

  async function paste(
    ctx: Partial<CommandContext>,
    completes = true,
  ): Promise<{
    completed: unknown[]
    errors: unknown[]
    successes: unknown[]
  }> {
    const error = spyOn(toast, "error")
    const success = spyOn(toast, "success")
    const completed: unknown[] = []
    try {
      await apply?.(
        {
          summariesHistory: [],
          currentSummaryId: null,
          completePendingSummary: async (id: string, text: string) => {
            completed.push([id, text])
            return completes
          },
          ...ctx,
        } as unknown as CommandContext,
        "the answer",
      )
      return {
        completed,
        errors: error.mock.calls.map((c) => c[0]),
        successes: success.mock.calls.map((c) => c[0]),
      }
    } finally {
      error.mockRestore()
      success.mockRestore()
    }
  }

  const history = [
    { id: "done", status: "complete" },
    { id: "waiting", status: "pending" },
  ] as unknown as CommandContext["summariesHistory"]

  test("completes the open summary before any pending one", async () => {
    const result = await paste({
      currentSummaryId: "open",
      summariesHistory: history,
    })
    expect(result.completed).toEqual([["open", "the answer"]])
    expect(result.successes).toEqual(["External summary saved"])
  })

  test("falls back to the pending summary", async () => {
    const result = await paste({ summariesHistory: history })
    expect(result.completed).toEqual([["waiting", "the answer"]])
  })

  test("refuses when there is nothing to complete", async () => {
    const result = await paste({})
    expect(result).toEqual({
      completed: [],
      errors: ["No pending summary — use Copy Summary Prompt first"],
      successes: [],
    })
  })

  test("stays quiet when the save fails", async () => {
    const result = await paste({ currentSummaryId: "open" }, false)
    expect(result.completed).toHaveLength(1)
    expect(result.successes).toEqual([])
  })
})
