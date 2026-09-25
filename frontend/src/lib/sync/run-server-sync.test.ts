/**
 * `runServerSync` with fake I/O. The state setters are real reducers over
 * plain variables, so a test reads what the hook's state would hold after the
 * sync, including while it runs.
 */
import { describe, expect, test } from "bun:test"
import type { SetStateAction } from "react"

import type { SyncJobStatus } from "@/api"
import type { ChannelStats } from "@/types"
import {
  AUTO_SYNC_PAUSE_MS,
  failureStreakPauses,
  failureToast,
  followUntilTerminal,
  NO_CHANNELS_MESSAGE,
  OFFLINE_MESSAGE,
  PAUSED_MESSAGE,
  type RunServerSyncArgs,
  type RunServerSyncIO,
  runServerSync,
} from "./run-server-sync"

type Ch = SyncJobStatus["channels"][number]

const ch = (name: string, status: string, extra: Partial<Ch> = {}): Ch =>
  ({ channelId: `id-${name}`, channelName: name, status, ...extra }) as Ch

const job = (channels: Ch[], status = "completed"): SyncJobStatus =>
  ({ jobId: "job-1", status, channels }) as SyncJobStatus

function apply<T>(prev: T, action: SetStateAction<T>): T {
  return typeof action === "function" ? (action as (p: T) => T)(prev) : action
}

function harness(
  result: SyncJobStatus,
  overrides: Partial<RunServerSyncIO> = {},
) {
  const state = {
    scraping: new Set<string>(["other"]),
    scrapingDuringWait: new Set<string>(),
    stats: {} as Record<string, ChannelStats>,
    failures: 0,
    pauseUntil: 99 as number | null,
    warnings: [] as string[],
    errors: [] as string[],
    started: [] as unknown[],
    loads: 0,
    invalidations: 0,
  }
  const io: RunServerSyncIO = {
    isOffline: false,
    channelCount: 0,
    startSyncJob: async (body) => {
      state.started.push(body)
      return { jobId: "job-1" }
    },
    waitSyncJob: async () => {
      state.scrapingDuringWait = new Set(state.scraping)
      return result
    },
    getChannelStats: async (id) =>
      id === "id-nostats"
        ? null
        : ({ totalPosts: 5, latestId: 1 } as ChannelStats),
    loadChannels: async () => {
      state.loads++
    },
    invalidatePostViews: () => {
      state.invalidations++
    },
    setScrapingChannels: (a) => {
      state.scraping = apply(state.scraping, a)
    },
    setChannelStats: (a) => {
      state.stats = apply(state.stats, a)
    },
    setConsecutiveFailures: (a) => {
      state.failures = apply(state.failures, a)
    },
    setAutoSyncPauseUntil: (a) => {
      state.pauseUntil = apply(state.pauseUntil, a)
    },
    notify: {
      warning: (m) => state.warnings.push(m),
      error: (m) => state.errors.push(m),
    },
    now: () => 1_000,
    ...overrides,
  }
  return { io, state }
}

const args = (extra: Partial<RunServerSyncArgs> = {}): RunServerSyncArgs => ({
  channelIds: ["id-a", "id-b"],
  channelNames: ["a", "b"],
  source: "test",
  refresh: true,
  syncMode: "bulk",
  ...extra,
})

describe("when a sync is refused", () => {
  test("offline warns and starts nothing", async () => {
    const { io, state } = harness(job([]), { isOffline: true })
    await runServerSync(io, args())
    expect(state.warnings).toEqual([OFFLINE_MESSAGE])
    expect(state.started).toEqual([])
    expect(state.loads).toBe(0)
  })

  test("no channels starts nothing and says nothing", async () => {
    const { io, state } = harness(job([]))
    await runServerSync(io, args({ channelIds: [] }))
    expect(state.started).toEqual([])
    expect(state.warnings).toEqual([])
    expect(state.scraping).toEqual(new Set(["other"]))
  })

  test("a server with nothing to sync gets its own toast and still throws", async () => {
    const { io, state } = harness(job([]), {
      startSyncJob: async () => {
        throw new Error("400: No channels to sync")
      },
    })
    await expect(runServerSync(io, args())).rejects.toThrow("No channels")
    expect(state.errors).toEqual([NO_CHANNELS_MESSAGE])
    expect(state.scraping).toEqual(new Set(["other"]))
  })

  test("any other start failure throws without a toast", async () => {
    const { io, state } = harness(job([]), {
      startSyncJob: async () => {
        throw "boom"
      },
    })
    await expect(runServerSync(io, args())).rejects.toBe("boom")
    expect(state.errors).toEqual([])
  })
})

describe("a sync that runs", () => {
  test("marks its channels while it runs and only its own afterwards", async () => {
    const { io, state } = harness(job([ch("a", "success"), ch("b", "success")]))
    await runServerSync(io, args())
    expect(state.scrapingDuringWait).toEqual(new Set(["other", "a", "b"]))
    expect(state.scraping).toEqual(new Set(["other"]))
  })

  test("sends the ids, source and mode it was given", async () => {
    const { io, state } = harness(job([]))
    await runServerSync(io, args({ syncMode: "individual" }))
    expect(state.started).toEqual([
      { channelIds: ["id-a", "id-b"], source: "test", syncMode: "individual" },
    ])
  })

  test("a success clears the streak and stores stats with the new latest id", async () => {
    const { io, state } = harness(
      job([
        ch("a", "success", { newLatestId: 42 }),
        ch("b", "success", { newLatestId: null }),
        ch("nostats", "success"),
      ]),
    )
    state.failures = 2
    await runServerSync(io, args())
    expect(state.failures).toBe(0)
    expect(state.pauseUntil).toBeNull()
    expect(state.stats).toEqual({
      a: { totalPosts: 5, latestId: 42 },
      b: { totalPosts: 5, latestId: undefined },
    } as unknown as Record<string, ChannelStats>)
    expect(state.errors).toEqual([])
  })

  test("reloads channels always and refreshes post views only when asked", async () => {
    const first = harness(job([ch("a", "success")]))
    await runServerSync(first.io, args())
    expect(first.state.loads).toBe(1)
    expect(first.state.invalidations).toBe(1)

    const second = harness(job([ch("a", "success")]))
    await runServerSync(second.io, args({ refresh: false }))
    expect(second.state.loads).toBe(1)
    expect(second.state.invalidations).toBe(0)
  })
})

describe("failures", () => {
  test("one failure names the channel and its error", () => {
    expect(failureToast([ch("a", "failed", { error: "gone" })])).toBe(
      "Sync failed for @a: gone",
    )
    expect(failureToast([ch("a", "failed")])).toBe(
      "Sync failed for @a: Sync failed",
    )
    expect(failureToast([ch("a", "failed"), ch("b", "failed")])).toBe(
      "2 channel sync(s) failed",
    )
  })

  test("the streak pauses at max(3, channelCount)", () => {
    expect(failureStreakPauses(2, 0)).toBe(false)
    expect(failureStreakPauses(3, 0)).toBe(true)
    expect(failureStreakPauses(4, 5)).toBe(false)
    expect(failureStreakPauses(5, 5)).toBe(true)
  })

  test("all failed: counts them, toasts, reloads, then throws the first error", async () => {
    const { io, state } = harness(
      job([ch("a", "failed", { error: "gone" }), ch("b", "failed")]),
    )
    await expect(runServerSync(io, args())).rejects.toThrow("gone")
    expect(state.failures).toBe(2)
    expect(state.pauseUntil).toBe(99)
    expect(state.errors).toEqual(["2 channel sync(s) failed"])
    expect(state.loads).toBe(1)
    expect(state.scraping).toEqual(new Set(["other"]))
  })

  test("an all-failed sync with no error text throws the generic message", async () => {
    const { io } = harness(job([ch("a", "failed")]))
    await expect(runServerSync(io, args())).rejects.toThrow("Sync failed")
  })

  test("reaching the threshold pauses auto-sync for ten minutes", async () => {
    const { io, state } = harness(job([ch("a", "failed")]))
    state.failures = 2
    await expect(runServerSync(io, args())).rejects.toThrow()
    expect(state.failures).toBe(3)
    expect(state.pauseUntil).toBe(1_000 + AUTO_SYNC_PAUSE_MS)
    expect(AUTO_SYNC_PAUSE_MS).toBe(600_000)
    expect(state.errors).toEqual([
      PAUSED_MESSAGE,
      "Sync failed for @a: Sync failed",
    ])
  })

  test("a partial failure does not throw", async () => {
    const { io, state } = harness(
      job([ch("a", "success"), ch("b", "failed", { error: "x" })]),
    )
    await runServerSync(io, args())
    expect(state.failures).toBe(1)
    expect(state.errors).toEqual(["Sync failed for @b: x"])
  })

  test("skipped channels alone neither count nor throw", async () => {
    const { io, state } = harness(job([ch("a", "skipped")]))
    await runServerSync(io, args())
    expect(state.failures).toBe(0)
    expect(state.pauseUntil).toBe(99)
    expect(state.errors).toEqual([])
  })
})

describe("followUntilTerminal", () => {
  async function* stream(statuses: SyncJobStatus[]) {
    for (const s of statuses) yield s
  }

  test("applies every event up to and including the terminal one", async () => {
    const seen: string[] = []
    const done = await followUntilTerminal(
      stream([job([], "running"), job([], "completed"), job([], "running")]),
      (s) => seen.push(s.status),
    )
    expect(done?.status).toBe("completed")
    expect(seen).toEqual(["running", "completed"])
  })

  test("a stream that ends first answers null", async () => {
    const seen: string[] = []
    const done = await followUntilTerminal(stream([job([], "running")]), (s) =>
      seen.push(s.status),
    )
    expect(done).toBeNull()
    expect(seen).toEqual(["running"])
  })
})
