import { describe, expect, test } from "bun:test"
import {
  DEFAULT_DISCOVER_SIGNAL_WEIGHTS,
  type DiscoverSignalWeights,
  type DiscoveryCandidate,
  sortDiscoveryCandidates,
  weightedScore,
} from "./discover-candidates"

function candidate(
  name: string,
  counts: { forward: number; mention: number; link: number },
): DiscoveryCandidate {
  const total = counts.forward + counts.mention + counts.link
  return {
    name,
    counts,
    total,
    seenIn: [],
    seenInCount: 1,
    lastSeen: 100,
    isFollowed: false,
    samplePost: { channelName: "carrier", postId: 1, timestamp: 100 },
  }
}

describe("weightedScore", () => {
  test("applies the per-kind weights", () => {
    // 2 forwards + 1 mention + 3 links at 3/1/2 = 6 + 1 + 6 = 13
    expect(
      weightedScore(
        candidate("a", { forward: 2, mention: 1, link: 3 }),
        DEFAULT_DISCOVER_SIGNAL_WEIGHTS,
      ),
    ).toBe(13)
  })

  test("a zero weight removes a kind from the score entirely", () => {
    const weights: DiscoverSignalWeights = { forward: 1, mention: 0, link: 0 }
    expect(
      weightedScore(
        candidate("a", { forward: 2, mention: 9, link: 9 }),
        weights,
      ),
    ).toBe(2)
  })
})

describe("sortDiscoveryCandidates — weighted", () => {
  // Same `total`, different composition: this is the case plain `total`
  // cannot distinguish and the weighted sort exists for.
  const mentionHeavy = candidate("mentionHeavy", {
    forward: 0,
    mention: 6,
    link: 0,
  })
  const forwardHeavy = candidate("forwardHeavy", {
    forward: 6,
    mention: 0,
    link: 0,
  })

  test("total treats the two as tied and falls back to the name", () => {
    expect(mentionHeavy.total).toBe(forwardHeavy.total)
    expect(
      sortDiscoveryCandidates([mentionHeavy, forwardHeavy], "total").map(
        (c) => c.name,
      ),
    ).toEqual(["forwardHeavy", "mentionHeavy"])
  })

  test("weighted ranks forwards above mentions by default", () => {
    expect(
      sortDiscoveryCandidates(
        [mentionHeavy, forwardHeavy],
        "weighted",
        DEFAULT_DISCOVER_SIGNAL_WEIGHTS,
      ).map((c) => c.name),
    ).toEqual(["forwardHeavy", "mentionHeavy"])
  })

  test("user weights can invert the ranking", () => {
    expect(
      sortDiscoveryCandidates([mentionHeavy, forwardHeavy], "weighted", {
        forward: 1,
        mention: 5,
        link: 1,
      }).map((c) => c.name),
    ).toEqual(["mentionHeavy", "forwardHeavy"])
  })

  test("a lower-volume candidate can outrank a higher-volume one", () => {
    const fewForwards = candidate("fewForwards", {
      forward: 4,
      mention: 0,
      link: 0,
    })
    const manyMentions = candidate("manyMentions", {
      forward: 0,
      mention: 10,
      link: 0,
    })
    // 4×3 = 12 beats 10×1 = 10, even though total is 4 vs 10.
    expect(manyMentions.total).toBeGreaterThan(fewForwards.total)
    expect(
      sortDiscoveryCandidates(
        [manyMentions, fewForwards],
        "weighted",
        DEFAULT_DISCOVER_SIGNAL_WEIGHTS,
      ).map((c) => c.name),
    ).toEqual(["fewForwards", "manyMentions"])
  })

  test("other sort keys are unaffected by the weights", () => {
    const weird: DiscoverSignalWeights = { forward: 0, mention: 99, link: 0 }
    expect(
      sortDiscoveryCandidates(
        [mentionHeavy, forwardHeavy],
        "forward",
        weird,
      ).map((c) => c.name),
    ).toEqual(["forwardHeavy", "mentionHeavy"])
  })
})
