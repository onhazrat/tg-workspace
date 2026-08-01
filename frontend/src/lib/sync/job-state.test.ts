/**
 * Characterisation tests for the sync-job watcher's decisions (T2).
 *
 * These pin behaviour that G1 is about to move out of `ScraperContext`. Before
 * this file, none of it was covered: the context is 1,103 lines with zero tests,
 * and the plan gates G1 on exactly this because Playwright is not a substitute
 * for a unit-level net during a refactor.
 *
 * Written against **today's** behaviour, warts included — see
 * `hasRateLimitError`, which matches a regex against an error string. That is
 * recorded as a finding, not fixed here.
 */

import { describe, expect, test } from "bun:test"

import type { SyncJobStatus } from "@/api"
import {
  deriveScrapingChannels,
  hasRateLimitError,
  isTerminalSyncStatus,
  shouldFallBackToPolling,
  TERMINAL_SYNC_STATUSES,
} from "./job-state"

type Channel = SyncJobStatus["channels"][number]

function channel(over: Partial<Channel> = {}): Channel {
  return {
    channelId: "c1",
    channelName: "alpha",
    status: "pending",
    postsFetched: 0,
    ...over,
  } as Channel
}

function status(over: Partial<SyncJobStatus> = {}): SyncJobStatus {
  return {
    jobId: "j1",
    status: "running",
    channels: [],
    ...over,
  } as SyncJobStatus
}

describe("isTerminalSyncStatus", () => {
  test("the terminal set is exactly these three", () => {
    // Spelled out rather than derived from TERMINAL_SYNC_STATUSES on purpose.
    // A `test.each` over the constant is self-referential: deleting an entry
    // deletes a test case instead of failing one, so removing "cancelled"
    // silently went from 19 passing tests to 18 passing tests.
    expect([...TERMINAL_SYNC_STATUSES].sort()).toEqual([
      "cancelled",
      "completed",
      "failed",
    ])
  })

  test.each(["completed", "failed", "cancelled"])("%s is terminal", (s) => {
    expect(isTerminalSyncStatus(s)).toBe(true)
  })

  test.each(["running", "pending", "queued", ""])("%s is not terminal", (s) => {
    expect(isTerminalSyncStatus(s)).toBe(false)
  })

  test("an unknown status is not terminal, so the watcher keeps waiting", () => {
    // Characterising the *safe* direction: a status the client does not know
    // must not end the watch early, or a running job would appear to finish.
    expect(isTerminalSyncStatus("some-future-state")).toBe(false)
  })
})

describe("deriveScrapingChannels", () => {
  test("counts both running and pending as active", () => {
    // `pending` is deliberate: a queued channel is part of the in-flight job, and
    // excluding it would flicker the spinner off between channels.
    const result = deriveScrapingChannels(
      status({
        channels: [
          channel({ channelName: "a", status: "running" }),
          channel({ channelName: "b", status: "pending" }),
          channel({ channelName: "c", status: "success" }),
          channel({ channelName: "d", status: "failed" }),
        ],
      }),
    )
    expect([...result].sort()).toEqual(["a", "b"])
  })

  test("is empty once every channel has finished", () => {
    const result = deriveScrapingChannels(
      status({
        channels: [
          channel({ channelName: "a", status: "success" }),
          channel({ channelName: "b", status: "skipped" }),
        ],
      }),
    )
    expect(result.size).toBe(0)
  })

  test("de-duplicates by channel name", () => {
    // Two entries can carry the same name — the set is keyed by name, not id.
    const result = deriveScrapingChannels(
      status({
        channels: [
          channel({ channelId: "1", channelName: "a", status: "running" }),
          channel({ channelId: "2", channelName: "a", status: "pending" }),
        ],
      }),
    )
    expect(result.size).toBe(1)
  })

  test("an empty job produces an empty set, not undefined", () => {
    expect(deriveScrapingChannels(status()).size).toBe(0)
  })
})

describe("hasRateLimitError", () => {
  test("matches the phrase case-insensitively", () => {
    expect(
      hasRateLimitError(
        status({
          channels: [channel({ error: "Telegram RATE LIMIT exceeded" })],
        }),
      ),
    ).toBe(true)
  })

  test("is false when no channel carries an error", () => {
    expect(
      hasRateLimitError(status({ channels: [channel({ status: "success" })] })),
    ).toBe(false)
  })

  test("WART: any error containing the phrase trips it", () => {
    // Characterised, not fixed. This is a regex over the error *string*, so an
    // unrelated failure that happens to mention rate limiting turns the banner
    // on — and a backend wording change turns it silently off.
    expect(
      hasRateLimitError(
        status({
          channels: [
            channel({ error: "config error: rate limit setting is invalid" }),
          ],
        }),
      ),
    ).toBe(true)
  })

  test("WART: a 429 without the phrase does not trip it", () => {
    expect(
      hasRateLimitError(
        status({
          channels: [channel({ error: "HTTP 429 Too Many Requests" })],
        }),
      ),
    ).toBe(false)
  })

  test("an empty error string is ignored", () => {
    expect(
      hasRateLimitError(status({ channels: [channel({ error: "" })] })),
    ).toBe(false)
  })
})

describe("shouldFallBackToPolling", () => {
  test("a stream failure falls back to polling", () => {
    // Transport problems are recoverable: the poller rides them out.
    expect(shouldFallBackToPolling(false)).toBe(true)
  })

  test("our own timeout abort does not fall back", () => {
    // The job outlived `syncJobTimeoutMs`; the caller cancels it instead of
    // polling a job it has already given up on.
    expect(shouldFallBackToPolling(true)).toBe(false)
  })
})
