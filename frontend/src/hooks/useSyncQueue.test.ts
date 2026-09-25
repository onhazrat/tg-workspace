/**
 * The client sync queue: which queued channel starts next, and that a finished
 * one leaves the queue so the next can start. A stuck slot here stops every
 * queued sync for the rest of the session, with nothing on screen saying so.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"

import { nextSyncItems, useSyncQueue } from "@/hooks/useSyncQueue"
import type { Channel, SyncQueueItem } from "@/types"

const channel = (name: string) => ({ id: name, name }) as Channel

const item = (name: string): SyncQueueItem => ({
  queueId: name,
  channel: channel(name),
  source: "test",
  timestamp: 0,
})

afterEach(cleanup)

describe("nextSyncItems", () => {
  const queue = ["a", "b", "c", "d"].map(item)
  const ids = (items: SyncQueueItem[]) => items.map((i) => i.queueId)

  test("fills the free slots in queue order", () => {
    expect(ids(nextSyncItems(queue, new Set(), 2))).toEqual(["a", "b"])
  })

  test("skips items already running and counts them against the limit", () => {
    expect(ids(nextSyncItems(queue, new Set(["a"]), 3))).toEqual(["b", "c"])
  })

  test("starts nothing when every slot is taken", () => {
    expect(nextSyncItems(queue, new Set(["a", "b"]), 2)).toEqual([])
  })

  test("starts nothing while more are running than the limit now allows", () => {
    // The limit dropped under syncs already in flight from before.
    expect(nextSyncItems(queue, new Set(["x", "y", "z"]), 2)).toEqual([])
  })
})

describe("useSyncQueue", () => {
  test("a finished channel frees its slot for the next and reports completion", async () => {
    const started: string[] = []
    const finish: Array<() => void> = []
    const processItem = (ch: Channel) =>
      new Promise<void>((resolve) => {
        started.push(ch.name)
        finish.push(resolve)
      })
    const { result } = renderHook(() => useSyncQueue(processItem, false, 1))
    const completed: string[] = []

    act(() => {
      result.current.addToSyncQueue(channel("a"), "test", () =>
        completed.push("a"),
      )
      result.current.addToSyncQueue(channel("b"), "test", () =>
        completed.push("b"),
      )
    })
    // Newest first: the queue is prepended to.
    await waitFor(() => expect(started).toEqual(["b"]))

    await act(async () => finish[0]())
    await waitFor(() => expect(started).toEqual(["b", "a"]))
    expect(completed).toEqual(["b"])
    expect(result.current.syncQueue.map((i) => i.queueId)).toEqual(["a"])
  })

  test("holds the queue while a summary is being generated", async () => {
    const started: string[] = []
    const processItem = async (ch: Channel) => {
      started.push(ch.name)
    }
    const { result, rerender } = renderHook(
      ({ summarizing }) => useSyncQueue(processItem, summarizing, 1),
      { initialProps: { summarizing: true } },
    )

    act(() => result.current.addToSyncQueue(channel("a"), "test"))
    await act(() => new Promise((done) => setTimeout(done, 20)))
    expect(started).toEqual([])

    rerender({ summarizing: false })
    await waitFor(() => expect(started).toEqual(["a"]))
  })
})
