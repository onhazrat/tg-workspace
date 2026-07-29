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
  samplePost: { channelName: string; postId: number; timestamp: number }
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
]

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

function sortValue(
  candidate: DiscoveryCandidate,
  sortKey: DiscoverSortKey,
  weights: DiscoverSignalWeights,
): number {
  if (sortKey === "total") return candidate.total
  if (sortKey === "weighted") return weightedScore(candidate, weights)
  if (sortKey === "lastSeen") return candidate.lastSeen
  if (sortKey === "seenInCount") return candidate.seenInCount
  return candidate.counts[sortKey]
}

export function sortDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
  sortKey: DiscoverSortKey = "total",
  weights: DiscoverSignalWeights = DEFAULT_DISCOVER_SIGNAL_WEIGHTS,
): DiscoveryCandidate[] {
  return [...candidates].sort((a, b) => {
    const delta =
      sortValue(b, sortKey, weights) - sortValue(a, sortKey, weights)
    if (delta !== 0) return delta
    if (b.total !== a.total) return b.total - a.total
    if (b.seenInCount !== a.seenInCount) return b.seenInCount - a.seenInCount
    if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen
    return a.name.localeCompare(b.name)
  })
}

/* -------------------------------------------------------------------------- */
/* Filtering                                                                  */
/* -------------------------------------------------------------------------- */

export type DiscoverFollowState = "all" | "unfollowed" | "followed" | "ignored"

export const DISCOVER_FOLLOW_STATE_OPTIONS: {
  label: string
  value: DiscoverFollowState
}[] = [
  { label: "All", value: "all" },
  { label: "Unfollowed", value: "unfollowed" },
  { label: "Followed", value: "followed" },
  { label: "Ignored", value: "ignored" },
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
 * Dismissed candidates are hidden from *every* view except "Ignored" — the
 * whole point of D8 is that a rejection stops costing attention on later runs,
 * which a merely-labelled row in the "All" list would not achieve. "Ignored" is
 * their one home, which keeps the dismissal reviewable and undoable rather than
 * a silent blocklist.
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
