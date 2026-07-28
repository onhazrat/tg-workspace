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
  { label: "Forwards", value: "forward" },
  { label: "Mentions", value: "mention" },
  { label: "Links", value: "link" },
  { label: "Last seen", value: "lastSeen" },
  { label: "Seen by", value: "seenInCount" },
]

function sortValue(
  candidate: DiscoveryCandidate,
  sortKey: DiscoverSortKey,
): number {
  if (sortKey === "total") return candidate.total
  if (sortKey === "lastSeen") return candidate.lastSeen
  if (sortKey === "seenInCount") return candidate.seenInCount
  return candidate.counts[sortKey]
}

export function sortDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
  sortKey: DiscoverSortKey = "total",
): DiscoveryCandidate[] {
  return [...candidates].sort((a, b) => {
    const delta = sortValue(b, sortKey) - sortValue(a, sortKey)
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

export type DiscoverFollowState = "all" | "unfollowed" | "followed"

export const DISCOVER_FOLLOW_STATE_OPTIONS: {
  label: string
  value: DiscoverFollowState
}[] = [
  { label: "All", value: "all" },
  { label: "Unfollowed", value: "unfollowed" },
  { label: "Followed", value: "followed" },
]

export const DISCOVER_MIN_TOTAL_OPTIONS: { label: string; value: number }[] = [
  { label: "1+", value: 1 },
  { label: "2+", value: 2 },
  { label: "5+", value: 5 },
]

export interface DiscoveryFilterOptions {
  followState: DiscoverFollowState
  minTotal: number
  nameQuery: string
}

export function filterDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
  options: DiscoveryFilterOptions,
): DiscoveryCandidate[] {
  const query = options.nameQuery.trim().toLowerCase()
  return candidates.filter((candidate) => {
    if (candidate.total < options.minTotal) return false
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
