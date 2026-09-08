import { describe, expect, it } from "bun:test"

import type { DiscoverProbeQueue } from "@/api"
import {
  DRAINING_POLL_INTERVAL_MS,
  IDLE_POLL_INTERVAL_MS,
  probeQueueRefetchInterval,
  shouldPollProbeQueue,
} from "@/hooks/useDiscoverProbeQueue"

const queue = (over: Partial<DiscoverProbeQueue> = {}): DiscoverProbeQueue => ({
  queued: 0,
  retrying: 0,
  resolved: 0,
  unavailable: 0,
  enabled: true,
  running: false,
  requestsToday: 0,
  requestsWeek: 0,
  harvestEnabled: false,
  harvestRunning: false,
  ...over,
})

/**
 * The whole of the client's remaining role in probing, kept as a pure function
 * on purpose: it is the only shape this repo can actually test. Component tests
 * render to static markup, so no effect, timer or hook behaviour runs — which is
 * precisely why the sweep state machine this replaced had no coverage at all.
 */
describe("shouldPollProbeQueue", () => {
  it("polls while handles are waiting to be checked", () => {
    expect(shouldPollProbeQueue(queue({ queued: 12 }))).toBe(true)
  })

  it("polls while a batch is in flight even with an empty queue", () => {
    expect(shouldPollProbeQueue(queue({ running: true }))).toBe(true)
  })

  it("stops once nothing is outstanding", () => {
    expect(shouldPollProbeQueue(queue({ resolved: 40 }))).toBe(false)
  })

  it("does not poll before the first read has landed", () => {
    expect(shouldPollProbeQueue(undefined)).toBe(false)
  })

  it("does not poll while probing is paused", () => {
    expect(shouldPollProbeQueue(queue({ queued: 12, enabled: false }))).toBe(
      false,
    )
  })

  it("ignores retrying handles", () => {
    // These come due on a 15min–24h backoff, and a permanently unreachable one
    // retries forever. Polling for them would mean polling for the life of the
    // tab to watch something that changes a few times a day.
    expect(shouldPollProbeQueue(queue({ retrying: 3 }))).toBe(false)
  })

  it("still polls when a retry is queued alongside fresh work", () => {
    expect(shouldPollProbeQueue(queue({ queued: 1, retrying: 3 }))).toBe(true)
  })
})

/**
 * The cadence the query actually runs on, which is the drain predicate plus one
 * case it deliberately has no opinion about: an idle queue whose spend figures
 * are on screen (ticket 04). `shouldPollProbeQueue` answers "is there work in
 * flight" and still does; this answers "should we re-read", and those stopped
 * being the same question once the bar became permanent for an Operator.
 */
describe("probeQueueRefetchInterval", () => {
  it("keeps the drain cadence while work is outstanding", () => {
    expect(probeQueueRefetchInterval(queue({ queued: 12 }), false)).toBe(
      DRAINING_POLL_INTERVAL_MS,
    )
  })

  it("refreshes an idle queue slowly for an account that may manage jobs", () => {
    // The spend total is what is on screen now, and it moves a few times a day.
    expect(probeQueueRefetchInterval(queue({ resolved: 40 }), true)).toBe(
      IDLE_POLL_INTERVAL_MS,
    )
  })

  it("refreshes a paused idle queue too", () => {
    // `enabled` gates the drain poll because a paused queue cannot drain. It
    // does not gate this one: a paused lane still has a day's spend to report.
    expect(probeQueueRefetchInterval(queue({ enabled: false }), true)).toBe(
      IDLE_POLL_INTERVAL_MS,
    )
  })

  it("stops entirely when an idle queue is on nobody's screen", () => {
    // Without the permission the bar renders nothing while idle, so a poll here
    // would be a request for a figure nobody is shown.
    expect(probeQueueRefetchInterval(queue({ resolved: 40 }), false)).toBe(
      false,
    )
  })

  it("does not poll before the first read has landed", () => {
    expect(probeQueueRefetchInterval(undefined, true)).toBe(false)
  })

  it("prefers the drain cadence over the idle one", () => {
    expect(probeQueueRefetchInterval(queue({ running: true }), true)).toBe(
      DRAINING_POLL_INTERVAL_MS,
    )
  })

  it("is a great deal slower when idle than when draining", () => {
    // The point of the second cadence: a daily and weekly total does not need a
    // four-second poll, and this one runs for the life of an open tab.
    expect(IDLE_POLL_INTERVAL_MS).toBeGreaterThan(
      DRAINING_POLL_INTERVAL_MS * 10,
    )
  })
})
