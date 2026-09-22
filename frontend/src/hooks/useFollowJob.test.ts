/**
 * A Follow is complete when the relation exists, not when its First sync ends.
 *
 * Discover disables its Follow buttons for as long as `followDiscoverChannels`
 * is pending. It used to await the First sync as well, which can take minutes,
 * so one click locked every other Candidate until the sync finished or the tab
 * was remounted. These tests hold the First sync open forever and assert the
 * follow still resolves.
 */

import { describe, expect, test } from "bun:test"
import { renderHook } from "@testing-library/react"

import type { FollowJobStatus, SyncJobStatus } from "@/api"
import { type FollowJobDeps, useFollowJob } from "@/hooks/useFollowJob"

function followStatus(names: string[]): FollowJobStatus {
  return {
    followJobId: "follow-1",
    status: "completed",
    source: "discover",
    total: names.length,
    completed: names.length,
    added: names.length,
    skipped: 0,
    unavailable: 0,
    failed: 0,
    results: names.map((name) => ({ name, status: "added" })),
    syncJobId: "sync-1",
    createdAt: 0,
    finishedAt: 1,
  }
}

/** Applies each `setScrapingChannels` update, so a test can read the set. */
function scrapingSet() {
  let current = new Set<string>()
  const set: FollowJobDeps["setScrapingChannels"] = (update) => {
    current = typeof update === "function" ? update(current) : update
  }
  return { set, read: () => current }
}

function deps(
  overrides: Partial<FollowJobDeps>,
  names: string[] = ["alpha"],
): FollowJobDeps {
  return {
    isOffline: false,
    proxyEnabled: false,
    defaultProxyUrls: "",
    torEnabled: false,
    torMode: "off",
    torProxyUrls: "",
    torAutoRotate: false,
    torRotationThreshold: 0,
    setSelectedChannels: () => {},
    setChannelStats: () => {},
    loadChannels: async () => {},
    invalidatePostViews: () => {},
    waitSyncJob: () => new Promise<SyncJobStatus>(() => {}),
    setScrapingChannels: () => {},
    followApi: {
      bulkFollowChannels: async () => ({ followJobId: "follow-1" }),
      getFollowJobStatus: async () => followStatus(names),
      // Ends at once, so the job is read through its status fallback.
      streamFollowJobEvents: async function* () {},
    },
    ...overrides,
  } as FollowJobDeps
}

/** Rejects if `promise` is still pending after `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`still pending after ${ms}ms`)), ms),
    ),
  ])
}

describe("followDiscoverChannels", () => {
  test("resolves once the Follow exists, while its First sync is still running", async () => {
    const { result } = renderHook(() => useFollowJob(deps({})))

    const status = await within(
      result.current.followDiscoverChannels([{ name: "alpha" }]),
      500,
    )

    expect(status?.added).toBe(1)
  })

  test("a running First sync keeps its Channel marked as syncing", async () => {
    const scraping = scrapingSet()
    const { result } = renderHook(() =>
      useFollowJob(deps({ setScrapingChannels: scraping.set })),
    )

    await within(
      result.current.followDiscoverChannels([{ name: "alpha" }]),
      500,
    )

    expect([...scraping.read()]).toEqual(["alpha"])
  })

  test("a second follow does not clear the first one's syncing mark", async () => {
    const scraping = scrapingSet()
    const first = renderHook(() =>
      useFollowJob(deps({ setScrapingChannels: scraping.set }, ["alpha"])),
    )
    const second = renderHook(() =>
      useFollowJob(deps({ setScrapingChannels: scraping.set }, ["beta"])),
    )

    await within(
      first.result.current.followDiscoverChannels([{ name: "alpha" }]),
      500,
    )
    await within(
      second.result.current.followDiscoverChannels([{ name: "beta" }]),
      500,
    )

    expect([...scraping.read()].sort()).toEqual(["alpha", "beta"])
  })
})
