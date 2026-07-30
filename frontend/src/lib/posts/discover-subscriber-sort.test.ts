import { describe, expect, test } from "bun:test"
import {
  candidateSubscriberCount,
  type DiscoveryCandidate,
  type DiscoveryProbe,
  sortDiscoveryCandidates,
} from "./discover-candidates"

/**
 * Ranking by channel size, whose defining problem is the rows that have no size.
 *
 * The count comes from the async probe sweep, so on any fresh report most rows
 * carry no number at all — which makes "where does unknown go" the whole design
 * question rather than an edge case.
 */

function probe(subscribers: string | null): DiscoveryProbe {
  return {
    handle: "h",
    status: "ok",
    kind: "channel",
    displayName: null,
    bio: null,
    subscribers,
    photoUrl: null,
    attempts: 1,
    lastError: null,
    checkedAt: 1000,
  }
}

function candidate(
  name: string,
  subscribers: string | null | undefined,
  total = 1,
): DiscoveryCandidate {
  return {
    name,
    counts: { forward: total, mention: 0, link: 0 },
    total,
    seenIn: [],
    seenInCount: 1,
    lastSeen: 100,
    isFollowed: false,
    // `undefined` is the never-probed row; a probe carrying `null` is a handle
    // that was reached but showed no counter.
    probe: subscribers === undefined ? undefined : probe(subscribers),
    samplePost: { channelName: "carrier", postId: 1, timestamp: 100 },
  }
}

describe("candidateSubscriberCount", () => {
  test("reads the probe's count", () => {
    expect(candidateSubscriberCount(candidate("a", "12.5K"))).toBe(12_500)
  })

  test("null for a candidate that was never probed", () => {
    expect(candidateSubscriberCount(candidate("a", undefined))).toBeNull()
  })

  test("null for a probe that found no counter", () => {
    expect(candidateSubscriberCount(candidate("a", null))).toBeNull()
  })
})

describe("sortDiscoveryCandidates — subscribers", () => {
  test("largest first", () => {
    const rows = [
      candidate("small", "573"),
      candidate("huge", "1.2M"),
      candidate("medium", "12.5K"),
    ]
    expect(
      sortDiscoveryCandidates(rows, "subscribers").map((c) => c.name),
    ).toEqual(["huge", "medium", "small"])
  })

  // The explicit ask: handles with no count go to the end, not to a position
  // implied by treating the absence as zero.
  test("handles with no count sort after every known count", () => {
    const rows = [
      candidate("unprobed", undefined),
      candidate("small", "42"),
      candidate("noCounter", null),
      candidate("big", "9K"),
    ]
    // Both unknown rows tie on every signal, so they land in name order — the
    // last tie-break. What matters is that both follow every known count.
    expect(
      sortDiscoveryCandidates(rows, "subscribers").map((c) => c.name),
    ).toEqual(["big", "small", "noCounter", "unprobed"])
  })

  // The trap `?? 0` would fall into: an unprobed handle outranking a channel we
  // actually measured and found tiny.
  test("a genuine zero still outranks an unknown", () => {
    const rows = [candidate("unprobed", undefined), candidate("empty", "0")]
    expect(
      sortDiscoveryCandidates(rows, "subscribers").map((c) => c.name),
    ).toEqual(["empty", "unprobed"])
  })

  test("unknowns keep the reference-strength tie-breaks among themselves", () => {
    const rows = [
      candidate("weak", undefined, 1),
      candidate("known", "500", 1),
      candidate("strong", undefined, 9),
    ]
    expect(
      sortDiscoveryCandidates(rows, "subscribers").map((c) => c.name),
    ).toEqual(["known", "strong", "weak"])
  })

  test("an all-unknown report falls back to the default ordering", () => {
    const rows = [
      candidate("weak", undefined, 2),
      candidate("strong", undefined, 7),
    ]
    expect(
      sortDiscoveryCandidates(rows, "subscribers").map((c) => c.name),
    ).toEqual(sortDiscoveryCandidates(rows, "total").map((c) => c.name))
  })

  test("the other sort keys are unaffected by a missing probe", () => {
    const rows = [candidate("a", undefined, 1), candidate("b", "1M", 5)]
    expect(sortDiscoveryCandidates(rows, "total").map((c) => c.name)).toEqual([
      "b",
      "a",
    ])
  })
})
