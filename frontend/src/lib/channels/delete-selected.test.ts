import { describe, expect, it, mock } from "bun:test"

import { ApiError } from "@/api/base"
import type { CommandContext } from "@/lib/commands/types"
import type { Channel } from "@/types"

import { deleteSelectedChannels } from "./delete-selected"

function makeChannel(name: string): Channel {
  return { id: name, name, lastUpdated: 0, followedAt: 0 }
}

function makeContext(names: string[]): CommandContext {
  return {
    channels: names.map(makeChannel),
    selectedChannels: new Set(names),
    setSelectedChannels: mock(() => {}),
    loadChannels: mock(async () => {}),
    loadDBStats: mock(async () => {}),
  } as unknown as CommandContext
}

describe("deleteSelectedChannels", () => {
  it("removes every selected channel", async () => {
    const ctx = makeContext(["alpha", "beta", "gamma"])
    const removed: string[] = []

    await deleteSelectedChannels(ctx, async (id) => {
      removed.push(id)
    })

    expect(removed).toEqual(["alpha", "beta", "gamma"])
    expect(ctx.setSelectedChannels).toHaveBeenCalled()
  })

  it("keeps going when one channel fails, and still clears the selection", async () => {
    // The loop used to let the rejection escape: the channels after the
    // failing one were never removed, the selection was never cleared, and no
    // toast fired — which reads as the whole action having done nothing. With
    // the channel list unscoped until ticket 15, a selection containing a
    // channel this account does not follow is an ordinary thing to have.
    const ctx = makeContext(["alpha", "beta", "gamma"])
    const removed: string[] = []

    await deleteSelectedChannels(ctx, async (id) => {
      if (id === "beta") throw new Error("boom")
      removed.push(id)
    })

    expect(removed).toEqual(["alpha", "gamma"])
    expect(ctx.setSelectedChannels).toHaveBeenLastCalledWith(new Set())
  })

  it("treats a 404 as already removed rather than a failure", async () => {
    // Asserted on `deleteChannelByRecord` directly, not through the loop: the
    // loop catches everything, so a rethrown 404 would still leave the loop's
    // observable behaviour identical and the test green for the wrong reason.
    // The claim is that this call *resolves* and goes on to refresh the list.
    const ctx = makeContext(["alpha"])
    const { deleteChannelByRecord } = await import("./delete-channel")

    await deleteChannelByRecord(makeChannel("alpha"), ctx, async () => {
      throw new ApiError(404, "Channel not found")
    })

    expect(ctx.loadChannels).toHaveBeenCalled()
    expect(ctx.setSelectedChannels).toHaveBeenCalled()
  })

  it("rethrows a non-404 from a single removal", async () => {
    const ctx = makeContext(["alpha"])
    const { deleteChannelByRecord } = await import("./delete-channel")

    await expect(
      deleteChannelByRecord(makeChannel("alpha"), ctx, async () => {
        throw new ApiError(500, "boom")
      }),
    ).rejects.toThrow("boom")
  })
})
