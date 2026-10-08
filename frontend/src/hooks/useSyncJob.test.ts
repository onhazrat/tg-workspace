/**
 * Sync All's stop handle: the hook keeps the running Sync All job's id from
 * its start until it settles, and stopping cancels that job. Spies on the
 * `api` object rather than `mock.module`, which is process-wide in Bun.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { act, renderHook, waitFor } from "@testing-library/react"
import { api, type SyncJobStatus } from "@/api"
import { useSyncJob } from "./useSyncJob"

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

/** A job that stays running until `settle` is called. */
function stubJob() {
  let settle = () => {}
  const done = new Promise<void>((resolve) => {
    settle = resolve
  })
  const status = (s: string) =>
    ({ jobId: "job-1", status: s, channels: [] }) as unknown as SyncJobStatus
  spies.push(
    spyOn(api, "startSyncJob").mockResolvedValue({ jobId: "job-1" } as never),
    spyOn(api, "getSyncJobStatus").mockImplementation(async () => {
      await done
      return status("cancelled")
    }),
  )
  const cancel = spyOn(api, "cancelSyncJob").mockImplementation(async () => {
    settle()
    return status("cancelled") as never
  })
  spies.push(cancel)
  // The event stream cannot open here, so the hook polls; its warning is noise.
  spies.push(spyOn(console, "warn").mockImplementation(() => {}))
  return { cancel, settle }
}

describe("useSyncJob Sync All stop", () => {
  test("holds the Sync All job while it runs, and stopping cancels it", async () => {
    const { cancel } = stubJob()
    const { result } = renderHook(() => useSyncJob(deps))
    let run: Promise<void> = Promise.resolve()
    act(() => {
      run = result.current.runServerSync(
        ["1"],
        ["a"],
        "Manual",
        true,
        "sync_all",
      )
    })
    await waitFor(() => expect(result.current.syncAllJobId).toBe("job-1"))
    await act(() => result.current.stopSyncAll())
    expect(cancel).toHaveBeenCalledWith("job-1")
    await act(() => run)
    expect(result.current.syncAllJobId).toBeNull()
  })

  test("a bulk sync is not Sync All, so there is nothing to stop", async () => {
    const { cancel, settle } = stubJob()
    const { result } = renderHook(() => useSyncJob(deps))
    let run: Promise<void> = Promise.resolve()
    act(() => {
      run = result.current.runServerSync(["1"], ["a"], "Manual", true, "bulk")
    })
    await waitFor(() => expect(api.startSyncJob).toHaveBeenCalled())
    expect(result.current.syncAllJobId).toBeNull()
    await act(() => result.current.stopSyncAll())
    expect(cancel).not.toHaveBeenCalled()
    settle()
    await act(() => run)
  })
})
