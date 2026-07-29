import { describe, expect, it } from "bun:test"

import type { DiscoverProbeQueue } from "@/api"
import { shouldPollProbeQueue } from "@/hooks/useDiscoverProbeQueue"

const queue = (over: Partial<DiscoverProbeQueue> = {}): DiscoverProbeQueue => ({
  queued: 0,
  retrying: 0,
  resolved: 0,
  unavailable: 0,
  enabled: true,
  running: false,
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
