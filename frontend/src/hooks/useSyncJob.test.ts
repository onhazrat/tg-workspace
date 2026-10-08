/**
 * Stop sync: the hook keeps the running job's id for Sync All and Sync
 * selected, from the job's start until it settles, and stopping cancels that
 * exact job. Every other sync (a single Channel, Pre-Summary, Pre-Chat,
 * Auto-Regenerate) holds nothing, even when its mode is `bulk`. Spies on the
 * `api` object rather than `mock.module`, which is process-wide in Bun.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { act, renderHook, waitFor } from "@testing-library/react"
import { toast } from "sonner"

import { api, type SyncJobStatus } from "@/api"
import { type StoppableSync, useSyncJob } from "./useSyncJob"

const deps = {
  isOffline: false,
  channelCount: 1,
  setIsRateLimited: () => {},
  setChannelStats: () => {},
  loadChannels: async () => {},
  invalidatePostViews: () => {},
}

const spies: { mockRestore: () => void }[] = []
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

/** Jobs that stay running until cancelled; each start gets the next id. */
function stubJobs() {
  let next = 0
  const settlers = new Map<string, () => void>()
  const done = new Map<string, Promise<void>>()
  const status = (jobId: string) =>
    ({ jobId, status: "cancelled", channels: [] }) as unknown as SyncJobStatus
  spies.push(
    spyOn(api, "startSyncJob").mockImplementation(async () => {
      next += 1
      const jobId = `job-${next}`
      done.set(
        jobId,
        new Promise<void>((resolve) => settlers.set(jobId, resolve)),
      )
      return { jobId } as never
    }),
    spyOn(api, "getSyncJobStatus").mockImplementation(async (jobId) => {
      await done.get(jobId)
      return status(jobId) as never
    }),
  )
  const cancel = spyOn(api, "cancelSyncJob").mockImplementation(
    async (jobId) => {
      settlers.get(jobId)?.()
      return status(jobId) as never
    },
  )
  const info = spyOn(toast, "info").mockImplementation(() => "")
  // The event stream cannot open here, so the hook polls; its warning is noise.
  spies.push(
    cancel,
    info,
    spyOn(console, "warn").mockImplementation(() => {}),
  )
  return {
    cancel,
    info,
    settle: (jobId: string) => settlers.get(jobId)?.(),
  }
}

function start(
  hook: { current: ReturnType<typeof useSyncJob> },
  stoppable?: StoppableSync,
) {
  let run: Promise<void> = Promise.resolve()
  act(() => {
    run = hook.current.runServerSync(
      ["1"],
      ["a"],
      "Manual",
      true,
      stoppable === "sync_all" ? "sync_all" : "bulk",
      stoppable,
    )
  })
  return run
}

describe("useSyncJob Stop sync", () => {
  test.each(["sync_all", "selected"] as const)(
    "holds the %s job while it runs, and stopping cancels it",
    async (kind) => {
      const { cancel, info } = stubJobs()
      const { result } = renderHook(() => useSyncJob(deps))
      const run = start(result, kind)
      await waitFor(() =>
        expect(result.current.runningSyncJobs[kind]).toBe("job-1"),
      )
      await act(() => result.current.stopSync(kind))
      expect(cancel).toHaveBeenCalledWith("job-1")
      expect(info).toHaveBeenCalledWith("Sync stopped")
      await act(() => run)
      expect(result.current.runningSyncJobs[kind]).toBeNull()
    },
  )

  test("stopping one manual sync leaves the other running", async () => {
    const { cancel, settle } = stubJobs()
    const { result } = renderHook(() => useSyncJob(deps))
    const all = start(result, "sync_all")
    await waitFor(() =>
      expect(result.current.runningSyncJobs.sync_all).toBe("job-1"),
    )
    const selected = start(result, "selected")
    await waitFor(() =>
      expect(result.current.runningSyncJobs.selected).toBe("job-2"),
    )
    await act(() => result.current.stopSync("selected"))
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith("job-2")
    await act(() => selected)
    expect(result.current.runningSyncJobs).toEqual({
      sync_all: "job-1",
      selected: null,
    })
    settle("job-1")
    await act(() => all)
  })

  test("a bulk sync nobody asked to stop (Pre-Summary, Pre-Chat) holds nothing", async () => {
    const { cancel, settle } = stubJobs()
    const { result } = renderHook(() => useSyncJob(deps))
    const run = start(result)
    await waitFor(() => expect(api.startSyncJob).toHaveBeenCalled())
    expect(result.current.runningSyncJobs).toEqual({
      sync_all: null,
      selected: null,
    })
    await act(() => result.current.stopSync("selected"))
    expect(cancel).not.toHaveBeenCalled()
    settle("job-1")
    await act(() => run)
  })
})
