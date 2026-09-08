/**
 * What a Candidate row shows for the statistics, and what it says when it
 * cannot show them (ticket 02, ADR-015).
 *
 * A blank cell has three causes and they are not interchangeable to the person
 * reading the report:
 *
 * * **Not probed yet.** The sweep is asynchronous, so most of a fresh report is
 *   this. It is the absence of a measurement, and a row must never read as a
 *   bad score for it — that is the difference between "we have not looked" and
 *   "this Channel is dead", which is the whole judgement the row exists to
 *   support.
 * * **Too few samples.** The handle was probed and the Channel has fewer than
 *   five Posts on its preview page. The rates are suppressed server-side,
 *   because a cadence over three Posts is a number pretending to be a
 *   measurement — and the raw count shows instead, so the blank explains
 *   itself rather than looking like a bug.
 * * **Nothing to measure.** Probed, enough samples, but Telegram rendered no
 *   view counter on five of them, which is ordinary on older Posts.
 *
 * One function rather than three, because all three cells answer the first two
 * causes identically and splitting them is how one of them comes to answer
 * differently.
 */

import type { DiscoveryProbe } from "./discover-candidates"

/** Compact, because a Candidate row is scanned rather than read. */
const COMPACT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
})

export interface CandidateStatistics {
  /** Epoch ms of the newest sample Post, or `null`. */
  lastPostAt: number | null
  /** Formatted rate, or `null` when there is none to show. */
  postsPerWeek: string | null
  medianViews: string | null
  /**
   * Shown where the rate would be, when the sample set was too small for one.
   * `null` whenever a rate is showing or nothing was measured at all.
   */
  sampleNote: string | null
  /** What a blank cell means, as its tooltip. */
  placeholderTitle: string
}

const NOT_PROBED = "Not probed yet — this handle has not been fetched"
const NOT_MEASURED = "Probed, but Telegram showed nothing to measure here"
/**
 * Deliberately says what was measured rather than why there is no rate.
 *
 * Two conditions land here — a sample set below the five-Post threshold, and
 * one spread over no time at all, which a Channel posting an album as separate
 * messages produces at any size. "Too few Posts" is wrong for the second, and
 * the reader does not need the two told apart: the count is the fact, and it is
 * enough to see that the blank is the sample's fault rather than a bug.
 */
const NO_RATE = (count: number) =>
  `${count} sample ${count === 1 ? "Post" : "Posts"} — not enough to time a rate`

export function candidateStatistics(
  probe: DiscoveryProbe | null | undefined,
): CandidateStatistics {
  if (!probe) {
    return {
      lastPostAt: null,
      postsPerWeek: null,
      medianViews: null,
      sampleNote: null,
      placeholderTitle: NOT_PROBED,
    }
  }

  const { lastPostAt, postsPerWeek, medianViews, sampleCount } = probe
  return {
    lastPostAt,
    // One decimal below 10, none above: "0.4/week" and "31/week" are both
    // readable, "31.4/week" is precision the sample set does not have.
    postsPerWeek:
      postsPerWeek === null
        ? null
        : postsPerWeek.toFixed(postsPerWeek < 10 ? 1 : 0),
    medianViews: medianViews === null ? null : COMPACT.format(medianViews),
    sampleNote:
      postsPerWeek === null && sampleCount !== null
        ? `${sampleCount} ${sampleCount === 1 ? "post" : "posts"}`
        : null,
    placeholderTitle:
      postsPerWeek === null && sampleCount !== null
        ? NO_RATE(sampleCount)
        : NOT_MEASURED,
  }
}
