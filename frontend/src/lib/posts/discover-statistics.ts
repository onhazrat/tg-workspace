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

/**
 * The three statistics only the panel shows (ticket 03).
 *
 * Separate from `candidateStatistics` because they answer a different question
 * and are read at a different moment. The row's four are a triage set scanned
 * across forty Candidates; these three are read once, about one Channel, by
 * somebody who has already decided it is worth opening. Merging them would put
 * ten numbers in the shape a scan reads.
 *
 * Every field is `null` for *not measured*, and the panel says so in words
 * rather than showing a zero. Two of the three go absent for a whole class of
 * entry and it is not a fault: the mix and the density come from the preview
 * page's counters, which an `unavailable` verdict clears along with the page,
 * so a Channel Telegram has stopped serving keeps its cadence and loses these.
 */
export interface PanelStatistics {
  /** Share of sample Posts carrying a forward attribution, as a percentage. */
  forwardShare: string | null
  /** The alphabet the captions are in, named for a reader. */
  script: string | null
  /** Media items per published Post id, as a rate that may exceed 1. */
  mediaDensity: string | null
}

/**
 * Alphabets, not languages, and the wording says so where it matters.
 *
 * `arabic` is one script covering Persian, Arabic and Urdu; telling them apart
 * needs a language model where this is a character-range tally, and a Persian
 * corpus labelled "Arabic" would read as a wrong answer rather than a coarse
 * one. The other six name themselves.
 */
const SCRIPT_LABELS: Record<string, string> = {
  arabic: "Arabic / Persian",
  cyrillic: "Cyrillic",
  hebrew: "Hebrew",
  greek: "Greek",
  devanagari: "Devanagari",
  cjk: "CJK",
  latin: "Latin",
}

export function panelStatistics(
  probe: DiscoveryProbe | null | undefined,
): PanelStatistics {
  if (!probe) {
    return { forwardShare: null, script: null, mediaDensity: null }
  }

  const { forwardShare, script, mediaDensity } = probe
  return {
    // Whole percent. The share is over at most a preview page of Posts, so a
    // decimal place would be resolution the sample does not have — one Post in
    // twenty is 5%, and there is no 5.3% to report.
    forwardShare:
      forwardShare === null ? null : `${Math.round(forwardShare * 100)}%`,
    // An unrecognised value renders as itself rather than as nothing: the
    // backend's range list can grow a script this map has not learned yet, and
    // "tamil" is a better answer on screen than a blank.
    script: script === null ? null : (SCRIPT_LABELS[script] ?? script),
    mediaDensity: mediaDensity === null ? null : mediaDensity.toFixed(1),
  }
}
