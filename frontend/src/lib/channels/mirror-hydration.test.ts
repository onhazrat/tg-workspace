import { afterEach, describe, expect, it, mock } from "bun:test"
import * as cache from "@/lib/cache"
import type { Channel } from "@/types"
import {
  __resetMirrorHydration,
  hydrateChannelMirror,
} from "./mirror-hydration"

function channels(count: number): Channel[] {
  return Array.from(
    { length: count },
    (_, i) => ({ id: `id${i}`, name: `channel${i}` }) as Channel,
  )
}

afterEach(() => {
  __resetMirrorHydration()
  mock.restore()
})

describe("hydrateChannelMirror", () => {
  it("writes the channels through the bulk path", async () => {
    const saveChannels = mock(async () => {})
    mock.module("@/lib/cache", () => ({ ...cache, saveChannels }))

    await hydrateChannelMirror(channels(3))

    expect(saveChannels).toHaveBeenCalledTimes(1)
    expect(saveChannels.mock.calls[0][0]).toHaveLength(3)
  })

  /**
   * Callers do `void hydrateChannelMirror(...)`, so a rejection would become an
   * unhandled promise rejection. Mirror upkeep is housekeeping: the data the
   * user is looking at came from the server and is unaffected.
   */
  it("never rejects when the write fails", async () => {
    const saveChannels = mock(async () => {
      throw new Error("QuotaExceededError")
    })
    mock.module("@/lib/cache", () => ({ ...cache, saveChannels }))

    await expect(hydrateChannelMirror(channels(1))).resolves.toBeUndefined()
  })

  /**
   * A burst of refreshes must not queue overlapping bulk writes against the
   * same store.
   */
  it("reuses a run that is already in flight", async () => {
    let release: (() => void) | undefined
    const saveChannels = mock(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    mock.module("@/lib/cache", () => ({ ...cache, saveChannels }))

    const first = hydrateChannelMirror(channels(1))
    const second = hydrateChannelMirror(channels(1))
    expect(first).toBe(second)

    // Let the idle callback fire and the write settle.
    await new Promise((resolve) => setTimeout(resolve, 5))
    release?.()
    await first

    expect(saveChannels).toHaveBeenCalledTimes(1)
  })

  it("allows a later run once the previous one settles", async () => {
    const saveChannels = mock(async () => {})
    mock.module("@/lib/cache", () => ({ ...cache, saveChannels }))

    await hydrateChannelMirror(channels(1))
    await hydrateChannelMirror(channels(1))

    expect(saveChannels).toHaveBeenCalledTimes(2)
  })

  /**
   * B1's core property. The mirror write used to be one awaited IndexedDB
   * transaction per channel, in a loop, sitting in front of the data the
   * Channels tab renders — at ~1,070 channels that was the long skeleton phase.
   * The write must not begin during the caller's synchronous turn.
   */
  it("does not touch IndexedDB on the caller's turn", async () => {
    const saveChannels = mock(async () => {})
    mock.module("@/lib/cache", () => ({ ...cache, saveChannels }))

    const pending = hydrateChannelMirror(channels(1_070))

    // The caller has its data back and has already returned; nothing written yet.
    expect(saveChannels).not.toHaveBeenCalled()

    await pending
    expect(saveChannels).toHaveBeenCalledTimes(1)
  })

  it("passes the whole list to a single bulk write", async () => {
    const saveChannels = mock(async () => {})
    mock.module("@/lib/cache", () => ({ ...cache, saveChannels }))

    await hydrateChannelMirror(channels(1_070))

    // One transaction for the account, not one per channel.
    expect(saveChannels).toHaveBeenCalledTimes(1)
    expect(saveChannels.mock.calls[0][0]).toHaveLength(1_070)
  })
})
