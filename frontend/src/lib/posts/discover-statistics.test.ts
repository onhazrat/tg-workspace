import { describe, expect, test } from "bun:test"
import type { DiscoveryProbe } from "./discover-candidates"
import { candidateStatistics, panelStatistics } from "./discover-statistics"

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

/**
 * The three the panel adds (ticket 03).
 *
 * Two of them go absent for a whole class of entry and the panel has to say so
 * rather than showing a zero: the mix and the density are derived from the
 * preview page's counters, which an `unavailable` verdict clears along with the
 * page, while the cadence and the forward share survive it. A dead Channel
 * therefore reads "posted four times a week until fourteen months ago" with no
 * density beside it, and that pairing is the point of the split.
 *
 * ## Watched to fail
 *
 * * `?? 0` on any of the three → the not-probed test fails
 * * round the share to a decimal → the whole-percent test fails
 * * return `script` raw → the Arabic label test fails
 * * `SCRIPT_LABELS[script]` with no fallback → the unknown-script test fails
 * * clamp density at 1 → the album test fails
 */
describe("panelStatistics", () => {
  test("a candidate nobody has probed reads as not measured, not as zeroes", () => {
    const stats = panelStatistics(undefined)
    expect(stats.forwardShare).toBeNull()
    expect(stats.script).toBeNull()
    expect(stats.mediaDensity).toBeNull()
  })

  test("a channel that forwards nothing is 0%, which is a measurement", () => {
    // The one case where a zero is real: probed, sampled, and none of the
    // Posts carried an attribution. Distinct from `null`, and the panel shows
    // it — "0% forwarded" is what an original source looks like.
    expect(panelStatistics(probe({ forwardShare: 0 })).forwardShare).toBe("0%")
  })

  test("the share is whole percent, because the sample has no more resolution", () => {
    // A preview page is about twenty Posts, so the smallest real step is one
    // Post in twenty. A decimal place would print precision the input lacks.
    expect(panelStatistics(probe({ forwardShare: 0.333 })).forwardShare).toBe(
      "33%",
    )
  })

  test("the script is named for a reader, and Persian is not called Arabic", () => {
    // One script covers Persian, Arabic and Urdu, and separating them needs a
    // language model where the backend runs a character-range tally. Labelling
    // a Persian corpus "Arabic" reads as a wrong answer rather than a coarse
    // one, so the label carries both.
    expect(panelStatistics(probe({ script: "arabic" })).script).toBe(
      "Arabic / Persian",
    )
    expect(panelStatistics(probe({ script: "cjk" })).script).toBe("CJK")
  })

  test("a script this map has not learned renders as itself", () => {
    // The backend's range list can grow one. "tamil" on screen is a worse
    // label than "Tamil" and a much better one than a blank cell that reads as
    // "no captions in any alphabet".
    expect(panelStatistics(probe({ script: "tamil" })).script).toBe("tamil")
  })

  test("density may exceed one, because an album is five items on one id", () => {
    // The counters count media *items* and the denominator is the latest Post
    // id, so this is a rate and not a share. Clamping it would hide exactly the
    // Channels the number exists to identify.
    expect(panelStatistics(probe({ mediaDensity: 2.35 })).mediaDensity).toBe(
      "2.4",
    )
  })
})
