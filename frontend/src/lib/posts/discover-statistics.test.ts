import { describe, expect, test } from "bun:test"
import type { DiscoveryProbe } from "./discover-candidates"
import { candidateStatistics } from "./discover-statistics"

/**
 * What a Candidate row says when it cannot show a number (ticket 02).
 *
 * The formatting is the boring half. The half worth testing is that the three
 * blank causes stay distinguishable: a row that has not been probed must not
 * read as a Channel with bad numbers, and a row whose sample set was too small
 * must show what it had rather than looking broken.
 */

function probe(measured: Partial<DiscoveryProbe> = {}): DiscoveryProbe {
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

describe("candidateStatistics", () => {
  test("a candidate nobody has probed reads as not probed, not as zeroes", () => {
    const stats = candidateStatistics(undefined)
    expect(stats.lastPostAt).toBeNull()
    expect(stats.postsPerWeek).toBeNull()
    expect(stats.medianViews).toBeNull()
    expect(stats.sampleNote).toBeNull()
    expect(stats.placeholderTitle).toContain("Not probed yet")
  })

  test("a measured candidate shows its numbers", () => {
    const stats = candidateStatistics(
      probe({
        lastPostAt: 1_767_225_600_000,
        sampleCount: 20,
        postsPerWeek: 4.25,
        medianViews: 12_400,
      }),
    )
    expect(stats.lastPostAt).toBe(1_767_225_600_000)
    expect(stats.postsPerWeek).toBe("4.3")
    expect(stats.medianViews).toBe("12.4K")
    // Nothing to explain: the rate is showing.
    expect(stats.sampleNote).toBeNull()
  })

  test("a fast channel drops the decimal the sample cannot support", () => {
    expect(
      candidateStatistics(probe({ postsPerWeek: 31.4 })).postsPerWeek,
    ).toBe("31")
  })

  test("too small a sample shows the post count where the rate would be", () => {
    /**
     * The explicit ask. A median over three Posts is a number pretending to be
     * a measurement, so the server suppresses the rates — and the row shows
     * what it did have, so the blank explains itself rather than reading as a
     * failure to load.
     */
    const stats = candidateStatistics(probe({ sampleCount: 3, lastPostAt: 5 }))
    expect(stats.postsPerWeek).toBeNull()
    expect(stats.sampleNote).toBe("3 posts")
    expect(stats.placeholderTitle).toContain("3 sample Posts")
    // Last post age needs no threshold: one Post dates a Channel exactly.
    expect(stats.lastPostAt).toBe(5)
  })

  test("one sample is singular", () => {
    expect(candidateStatistics(probe({ sampleCount: 1 })).sampleNote).toBe(
      "1 post",
    )
  })

  test("a probed channel with nothing to measure says so, and differently", () => {
    /**
     * Probed, sampled well enough for a rate, and Telegram still rendered no
     * view counter on five of the Posts — ordinary on older ones. That is not
     * "too few samples" and not "not probed", and the tooltip must not claim
     * either.
     */
    const stats = candidateStatistics(
      probe({ sampleCount: 20, postsPerWeek: 4, medianViews: null }),
    )
    expect(stats.medianViews).toBeNull()
    expect(stats.sampleNote).toBeNull()
    expect(stats.placeholderTitle).not.toContain("Not probed")
    expect(stats.placeholderTitle).toContain("nothing to measure")
  })
})
