/**
 * Discover candidate *types and view logic* — sorting, result filtering, and
 * the empty-state reason.
 *
 * The aggregation itself lives in `backend/app/services/discover.py` and has no
 * counterpart here. A second implementation used to exist for the two scopes
 * the server could not reproduce (a semantic query, and the `random`
 * per-channel cap); both are now expressed server-side — as an explicit
 * `postIds` set and a shared seeded cap ordering — so the subtle counting
 * rules (one occurrence per kind per post, self-reference exclusion,
 * case-insensitive handles) cannot drift between two copies (IDEA-011 D14).
 */

import type { ForwardedFilterValue } from "@/lib/posts/post-view"
import { parseSubscriberCount } from "@/lib/subscriber-count"

export type DiscoverySignalKind = "forward" | "mention" | "link"

export const DISCOVERY_SIGNAL_KINDS: readonly DiscoverySignalKind[] = [
  "forward",
  "mention",
  "link",
] as const

export const DISCOVERY_SIGNAL_LABELS: Record<DiscoverySignalKind, string> = {
  forward: "Forwards",
  mention: "Mentions",
  link: "Links",
}

export type SignalCounts = Record<DiscoverySignalKind, number>

export interface DiscoverySeenIn {
  channelName: string
  counts: SignalCounts
  total: number
}

/** What kind of thing a handle turned out to be. Best effort — see D9. */
export type DiscoverProbeKind = "channel" | "group" | "bot" | "user" | "unknown"

/**
 * `ok` — a public channel that can be followed.
 * `unavailable` — real, but not followable (bot, account, group, private).
 * `unknown` — we could not reach a conclusion; will be retried.
 */
export type DiscoverProbeStatus = "ok" | "unavailable" | "unknown"

/**
 * What one fetch of `t.me/<handle>` told us (IDEA-011 D9).
 *
 * Absent (`null`/`undefined`) means *not checked yet*, which must render
 * differently from a verdict: an unprobed handle is not evidence of anything.
 */
export interface DiscoveryProbe {
  handle: string
  status: DiscoverProbeStatus
  kind: DiscoverProbeKind
  displayName: string | null
  bio: string | null
  subscribers: string | null
  photoUrl: string | null
  attempts: number
  lastError: string | null
  checkedAt: number | null
}

export interface DiscoveryCandidate {
  name: string
  displayName?: string
  counts: SignalCounts
  total: number
  seenIn: DiscoverySeenIn[]
  seenInCount: number
  lastSeen: number
  isFollowed: boolean
  /** Dismissed by the operator. Resolved live per read, never frozen into a report. */
  isIgnored?: boolean
  /**
   * Automated verdict on the handle. Deliberately separate from `isIgnored`:
   * one is a fact about the handle, the other a judgement by the operator, and
   * conflating them would let a misprobe pass for a deliberate choice.
   */
  probe?: DiscoveryProbe | null
  samplePost: { channelName: string; postId: number; timestamp: number }
}

export const DISCOVER_PROBE_KIND_LABELS: Record<DiscoverProbeKind, string> = {
  channel: "Channel",
  group: "Group",
  bot: "Bot",
  user: "Account",
  unknown: "Unknown",
}

/** True when a probe has concluded the handle cannot be followed. */
export function isProbedUnavailable(candidate: DiscoveryCandidate): boolean {
  return candidate.probe?.status === "unavailable"
}

export type DiscoveryEmptyReason =
  | "no_channels_selected"
  | "no_posts_in_scope"
  | "no_signals_enabled"
  | "original_only"
  | "no_candidates"
  | "no_matching_candidates"

export interface DiscoveryScopeCounts {
  forwardPosts: number
  mentionPosts: number
  linkPosts: number
}
/**
 * The empty-state reason for a computed candidate set, from scope facts alone.
 *
 * Derived on the client from facts the server returns — enabled kinds, selected
 * channels, posts-in-scope, candidate count — rather than from the post array,
 * which never reaches the browser. Its precedence must stay in lockstep with
 * the early returns in `compute_discover_candidates`.
 */
export function deriveDiscoveryEmptyReason(facts: {
  enabledKinds: ReadonlySet<DiscoverySignalKind>
  selectedChannelCount: number
  postsInScope: number
  candidateCount: number
  forwardedFilter: ForwardedFilterValue
}): DiscoveryEmptyReason | undefined {
  if (facts.enabledKinds.size === 0) return "no_signals_enabled"
  if (facts.selectedChannelCount === 0) return "no_channels_selected"
  if (facts.postsInScope === 0) return "no_posts_in_scope"
  if (facts.candidateCount === 0) {
    const forwardOnly =
      facts.enabledKinds.size === 1 && facts.enabledKinds.has("forward")
    return forwardOnly && facts.forwardedFilter === "original"
      ? "original_only"
      : "no_candidates"
  }
  return undefined
}

/* -------------------------------------------------------------------------- */
/* Sorting                                                                    */
/* -------------------------------------------------------------------------- */

export type DiscoverSortKey =
  | "total"
  | "weighted"
  | "forward"
  | "mention"
  | "link"
  | "lastSeen"
  | "seenInCount"
  | "subscribers"

export const DISCOVER_SORT_OPTIONS: {
  label: string
  value: DiscoverSortKey
}[] = [
  { label: "Total", value: "total" },
  { label: "Weighted", value: "weighted" },
  { label: "Forwards", value: "forward" },
  { label: "Mentions", value: "mention" },
  { label: "Links", value: "link" },
  { label: "Last seen", value: "lastSeen" },
  { label: "Seen by", value: "seenInCount" },
  { label: "Subscribers", value: "subscribers" },
]

/**
 * A candidate's subscriber count, or `null` when we do not know it.
 *
 * Unknown covers three states that are indistinguishable for ranking: never
 * probed, probed inconclusively, and probed off a page that carried no counter
 * at all (bots and personal accounts have none). Distinguishing them would not
 * change where the row belongs in a size ranking — the end — and `ProbeBadge`
 * already tells the operator which case a given row is.
 *
 * The count comes from the probe rather than from the report, so this key is the
 * one sort that depends on the asynchronous sweep: on a fresh report most rows
 * are `null` and migrate up the list as verdicts land (IDEA-011 D9).
 */
export function candidateSubscriberCount(
  candidate: DiscoveryCandidate,
): number | null {
  return parseSubscriberCount(candidate.probe?.subscribers)
}

/**
 * How much each signal kind counts toward the weighted score.
 *
 * `total` treats the three kinds as interchangeable, but they are not evidence
 * of the same strength: a **forward** means a channel you trust republished
 * that source, a **link** is a deliberate reference, and a bare **@mention**
 * may be a complaint, a disclaimer or a namedrop. The defaults encode that
 * ordering; the operator can retune them because the right ratio depends on
 * the corpus.
 */
export type DiscoverSignalWeights = Record<DiscoverySignalKind, number>

export const DEFAULT_DISCOVER_SIGNAL_WEIGHTS: DiscoverSignalWeights = {
  forward: 3,
  link: 2,
  mention: 1,
}

/** Bounds for the weight inputs — wide enough to express "ignore this kind" (0). */
export const DISCOVER_WEIGHT_MIN = 0
export const DISCOVER_WEIGHT_MAX = 99

export function weightedScore(
  candidate: DiscoveryCandidate,
  weights: DiscoverSignalWeights,
): number {
  return (
    candidate.counts.forward * weights.forward +
    candidate.counts.mention * weights.mention +
    candidate.counts.link * weights.link
  )
}

/** `null` when the candidate has no value for this key — see the null handling
 * in `sortDiscoveryCandidates`. Only `subscribers` can be unknown; every other
 * key is derived from reference counts the report always carries. */
function sortValue(
  candidate: DiscoveryCandidate,
  sortKey: DiscoverSortKey,
  weights: DiscoverSignalWeights,
): number | null {
  if (sortKey === "total") return candidate.total
  if (sortKey === "weighted") return weightedScore(candidate, weights)
  if (sortKey === "lastSeen") return candidate.lastSeen
  if (sortKey === "seenInCount") return candidate.seenInCount
  if (sortKey === "subscribers") return candidateSubscriberCount(candidate)
  return candidate.counts[sortKey]
}

export function sortDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
  sortKey: DiscoverSortKey = "total",
  weights: DiscoverSignalWeights = DEFAULT_DISCOVER_SIGNAL_WEIGHTS,
): DiscoveryCandidate[] {
  return [...candidates].sort((a, b) => {
    const aValue = sortValue(a, sortKey, weights)
    const bValue = sortValue(b, sortKey, weights)
    // Unknown always sinks to the end, never to a numeric position. Treating it
    // as 0 would put a not-yet-probed handle below a channel we actually know to
    // be tiny, asserting something we have not measured; treating it as
    // Infinity would top the list with rows carrying no evidence at all. Rows
    // that are both unknown fall through to the tie-breaks below, so they stay
    // ordered by reference strength rather than arbitrarily.
    if (aValue === null || bValue === null) {
      if (aValue !== bValue) return aValue === null ? 1 : -1
    } else if (aValue !== bValue) {
      return bValue - aValue
    }
    if (b.total !== a.total) return b.total - a.total
    if (b.seenInCount !== a.seenInCount) return b.seenInCount - a.seenInCount
    if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen
    return a.name.localeCompare(b.name)
  })
}

/* -------------------------------------------------------------------------- */
/* Filtering                                                                  */
/* -------------------------------------------------------------------------- */

export type DiscoverFollowState =
  | "all"
  | "unfollowed"
  | "followed"
  | "ignored"
  | "unavailable"

export const DISCOVER_FOLLOW_STATE_OPTIONS: {
  label: string
  value: DiscoverFollowState
}[] = [
  { label: "All", value: "all" },
  { label: "Unfollowed", value: "unfollowed" },
  { label: "Followed", value: "followed" },
  { label: "Ignored", value: "ignored" },
  { label: "Not followable", value: "unavailable" },
]

/**
 * Floor for the "Min hits" threshold.
 *
 * 1 rather than 0 because a candidate exists only by being referenced at least
 * once, so 0 and 1 would select the same rows.
 */
export const DISCOVER_MIN_TOTAL_MIN = 1

export interface DiscoveryFilterOptions {
  followState: DiscoverFollowState
  minTotal: number
  nameQuery: string
}

/**
 * Narrow a report's candidates to what the operator wants to look at.
 *
 * Two independent kinds of hiding, kept apart on purpose:
 *
 * * **Dismissed** (`isIgnored`) — the operator's judgement. Hidden from every
 *   view except "Ignored", because the point of D8 is that a rejection stops
 *   costing attention on later runs, which a merely-labelled row would not
 *   achieve.
 * * **Not followable** (`probe.status === "unavailable"`) — an automated
 *   verdict that the handle is a bot, an account, a group or a private channel.
 *   Hidden from every view except "Not followable" (D9).
 *
 * Each has exactly one home view, so both stay reviewable and reversible rather
 * than becoming a silent blocklist — and, crucially, a machine verdict never
 * appears in the same bucket as a deliberate one.
 *
 * A row can carry both flags, in which case the *dismissal* wins and it appears
 * only under "Ignored". The deliberate act is the more informative one to
 * preserve, and it keeps the two lists disjoint, so a count in one is never
 * partly explained by the other.
 *
 * Only a *concluded* verdict hides a row. A handle that has not been probed, or
 * whose probe was inconclusive, stays visible — absence of evidence is not
 * evidence, and the sweep is asynchronous, so half a report is normally
 * unprobed when it first renders.
 */
export function filterDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
  options: DiscoveryFilterOptions,
): DiscoveryCandidate[] {
  const query = options.nameQuery.trim().toLowerCase()
  return candidates.filter((candidate) => {
    if (candidate.total < options.minTotal) return false
    if (options.followState === "ignored") {
      if (!candidate.isIgnored) return false
    } else if (candidate.isIgnored) {
      return false
    }
    if (options.followState === "unavailable") {
      if (!isProbedUnavailable(candidate)) return false
    } else if (
      // Not in the "Ignored" view: a dismissed row belongs there whether or not
      // it also turned out to be unfollowable.
      options.followState !== "ignored" &&
      isProbedUnavailable(candidate)
    ) {
      return false
    }
    if (options.followState === "unfollowed" && candidate.isFollowed) {
      return false
    }
    if (options.followState === "followed" && !candidate.isFollowed) {
      return false
    }
    if (query) {
      const haystack =
        `${candidate.name} ${candidate.displayName ?? ""}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

export function countUnfollowedCandidates(
  candidates: DiscoveryCandidate[],
): number {
  return candidates.filter((candidate) => !candidate.isFollowed).length
}
