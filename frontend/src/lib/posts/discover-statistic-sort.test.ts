import { describe, expect, test } from "bun:test"
import {
  type DiscoverSortKey,
  type DiscoveryCandidate,
  type DiscoveryProbe,
  sortDiscoveryCandidates,
} from "./discover-candidates"

/**
 * Ranking a report by what the probe measured (ticket 02).
 *
 * Three new keys, and the defining problem is the same one `subscribers` has:
 * the numbers come from an asynchronous sweep, so on a fresh report most rows
 * carry nothing. Here it is sharper, because a row can be *probed* and still
 * measure nothing — a sample set below the five-Post threshold reports its
 * count and no rates at all. "Probed but unmeasured" and "not probed" have to
 * land in the same place, and that place is the end.
 *
 * Mutation-tested: treat a null as 0 in `sortValue` → the null-sinks tests fail
 * on every key; drop the `lastPostAt` branch → it falls through to
 * `candidate.counts[sortKey]` and every row reads `undefined`.
 */

type Measured = Partial<
  Pick<DiscoveryProbe, "lastPostAt" | "postsPerWeek" | "medianViews">
>

function probe(measured: Measured): DiscoveryProbe {
  return {
    handle: "h",
    status: "ok",
    kind: "channel",
    displayName: null,
    bio: null,
    subscribers: null,
    photoUrl: null,
    attempts: 1,
    lastError: null,
    checkedAt: 1000,
    lastPostAt: null,
    sampleCount: null,
    postsPerWeek: null,
    medianViews: null,
    forwardShare: null,
    script: null,
    mediaMix: null,
    mediaDensity: null,
    ...measured,
  }
}

function candidate(
  name: string,
  measured: Measured | undefined,
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
    // `undefined` is the never-probed row; a probe carrying nulls is a handle
    // that was reached and measured nothing — too few samples, or no counter.
    probe: measured === undefined ? undefined : probe(measured),
    reference: { channelName: "carrier", postId: 1, timestamp: 100 },
  }
}

const KEYS: { key: DiscoverSortKey; field: keyof Measured }[] = [
  { key: "lastPostAt", field: "lastPostAt" },
  { key: "postsPerWeek", field: "postsPerWeek" },
  { key: "medianViews", field: "medianViews" },
]

describe.each(KEYS)("sortDiscoveryCandidates — $key", ({ key, field }) => {
  test("largest first", () => {
    const rows = [
      candidate("small", { [field]: 10 }),
      candidate("big", { [field]: 900 }),
      candidate("middling", { [field]: 200 }),
    ]
    expect(sortDiscoveryCandidates(rows, key).map((c) => c.name)).toEqual([
      "big",
      "middling",
      "small",
    ])
  })

  test("a row that measured nothing sorts after every row that did", () => {
    const rows = [
      candidate("unprobed", undefined),
      candidate("tiny", { [field]: 1 }),
      candidate("unmeasured", {}),
      candidate("large", { [field]: 5000 }),
    ]
    const order = sortDiscoveryCandidates(rows, key).map((c) => c.name)
    expect(order.slice(0, 2)).toEqual(["large", "tiny"])
    // The two unknowns keep the reference-strength tie-break rather than an
    // arbitrary order, so they stay grouped at the end without swapping about
    // as unrelated rows arrive.
    expect(order.slice(2).sort()).toEqual(["unmeasured", "unprobed"])
  })

  test("an unmeasured row does not outrank a measured zero", () => {
    // Treating absent as 0 would tie these, and the tie-break would then decide
    // by reference strength — putting a Channel we know posts nothing level
    // with one we have not looked at.
    const rows = [
      candidate("unknown", {}, 9),
      candidate("measured", { [field]: 0 }, 1),
    ]
    expect(sortDiscoveryCandidates(rows, key).map((c) => c.name)).toEqual([
      "measured",
      "unknown",
    ])
  })
})

describe("sortDiscoveryCandidates — the keys stay independent", () => {
  test("a busy Channel that stopped posting ranks high on rate and low on age", () => {
    /**
     * The pairing the whole statistic exists for. Posts-per-week is a rate over
     * the span the samples cover, so a Channel that posted daily until it died
     * still reports a high rate — and last post age is what says it is dead.
     * A blended "recent activity" number would report both as mediocre.
     */
    const dead = candidate("dead", { postsPerWeek: 7, lastPostAt: 1_000 })
    const alive = candidate("alive", { postsPerWeek: 1, lastPostAt: 9_000 })
    const rows = [alive, dead]

    expect(sortDiscoveryCandidates(rows, "postsPerWeek")[0].name).toBe("dead")
    expect(sortDiscoveryCandidates(rows, "lastPostAt")[0].name).toBe("alive")
  })
})
