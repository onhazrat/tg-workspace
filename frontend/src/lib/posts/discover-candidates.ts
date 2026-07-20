/**
 * Unified Discover candidate aggregation across all three discovery signals:
 * forwards, `@mentions`, and `t.me/` links in the post body.
 *
 * Counting rules:
 * - Per post, a handle contributes at most one occurrence of each kind. The
 *   extractors return deduped sets, so a post repeating `@foo` counts once.
 * - Self-references (a channel naming itself) are excluded entirely.
 */

import type { ForwardedFilterValue } from "@/lib/posts/post-view"
import {
  extractMentions,
  extractPostLinkChannels,
  normalizeHandle,
} from "@/lib/posts/telegram-handles"
import type { Channel, Post } from "@/types"

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

export interface DiscoveryResult {
  candidates: DiscoveryCandidate[]
  /** Post-level counts per signal, always across all kinds regardless of filters. */
  scopeCounts: DiscoveryScopeCounts
  emptyReason?: DiscoveryEmptyReason
}

export interface DiscoveryContext {
  forwardedFilter: ForwardedFilterValue
  selectedChannelCount: number
  enabledKinds: ReadonlySet<DiscoverySignalKind>
  semanticQuery?: string
}

function emptyCounts(): SignalCounts {
  return { forward: 0, mention: 0, link: 0 }
}

function sumCounts(counts: SignalCounts): number {
  return counts.forward + counts.mention + counts.link
}

/**
 * Handles referenced by a post, per kind, with self-references removed.
 *
 * Always extracts every kind so a single pass can serve both the candidate
 * aggregation (which filters by enabled kinds) and the scope summary (which
 * always reports the full picture). The extractors are the expensive part.
 */
function postReferences(post: Post): Map<string, Set<DiscoverySignalKind>> {
  const self = normalizeHandle(post.channelName)
  const refs = new Map<string, Set<DiscoverySignalKind>>()

  const add = (handle: string, kind: DiscoverySignalKind) => {
    if (!handle || handle === self) return
    const existing = refs.get(handle)
    if (existing) existing.add(kind)
    else refs.set(handle, new Set([kind]))
  }

  if (post.forwardedFrom) {
    add(normalizeHandle(post.forwardedFrom), "forward")
  }
  for (const handle of extractMentions(post.text)) add(handle, "mention")
  for (const handle of extractPostLinkChannels(post)) add(handle, "link")

  return refs
}

interface Accumulator {
  canonicalName: string
  displayName?: string
  counts: SignalCounts
  byCarrier: Map<string, SignalCounts>
  lastSeen: number
  samplePost: Post
}

export function computeDiscoveryCandidates(
  filteredPosts: Post[],
  channels: Channel[],
  ctx: DiscoveryContext,
): DiscoveryResult {
  const emptyScope: DiscoveryScopeCounts = {
    forwardPosts: 0,
    mentionPosts: 0,
    linkPosts: 0,
  }

  if (ctx.enabledKinds.size === 0) {
    return {
      candidates: [],
      scopeCounts: countPostsBySignal(filteredPosts),
      emptyReason: "no_signals_enabled",
    }
  }

  if (ctx.selectedChannelCount === 0) {
    return {
      candidates: [],
      scopeCounts: emptyScope,
      emptyReason: "no_channels_selected",
    }
  }

  if (filteredPosts.length === 0) {
    return {
      candidates: [],
      scopeCounts: emptyScope,
      emptyReason: "no_posts_in_scope",
    }
  }

  const followed = new Set(
    channels.map((channel) => channel.name.toLowerCase()),
  )
  const bySource = new Map<string, Accumulator>()
  const scopeCounts: DiscoveryScopeCounts = { ...emptyScope }

  for (const post of filteredPosts) {
    const allRefs = postReferences(post)
    if (allRefs.size === 0) continue

    // Scope counts always report every kind, independent of what's enabled.
    let hasForward = false
    let hasMention = false
    let hasLink = false
    for (const kinds of allRefs.values()) {
      if (kinds.has("forward")) hasForward = true
      if (kinds.has("mention")) hasMention = true
      if (kinds.has("link")) hasLink = true
    }
    if (hasForward) scopeCounts.forwardPosts += 1
    if (hasMention) scopeCounts.mentionPosts += 1
    if (hasLink) scopeCounts.linkPosts += 1

    for (const [handle, allKinds] of allRefs) {
      const kinds = new Set(
        [...allKinds].filter((kind) => ctx.enabledKinds.has(kind)),
      )
      if (kinds.size === 0) continue

      let entry = bySource.get(handle)
      if (!entry) {
        entry = {
          // Preserve the first-seen casing for display; `handle` stays the key.
          canonicalName: kinds.has("forward")
            ? (post.forwardedFrom ?? handle).replace(/^@/, "").trim()
            : handle,
          counts: emptyCounts(),
          byCarrier: new Map(),
          lastSeen: post.timestamp,
          samplePost: post,
        }
        bySource.set(handle, entry)
      }

      let carrier = entry.byCarrier.get(post.channelName)
      if (!carrier) {
        carrier = emptyCounts()
        entry.byCarrier.set(post.channelName, carrier)
      }

      for (const kind of kinds) {
        entry.counts[kind] += 1
        carrier[kind] += 1
      }

      const isNewest = post.timestamp >= entry.lastSeen
      if (isNewest) {
        entry.lastSeen = post.timestamp
        entry.samplePost = post
      }
      // Forward metadata is the only source of a human-readable display name.
      if (kinds.has("forward") && post.forwardedFromName) {
        if (isNewest || !entry.displayName) {
          entry.displayName = post.forwardedFromName
          entry.canonicalName = (post.forwardedFrom ?? handle)
            .replace(/^@/, "")
            .trim()
        }
      }
    }
  }

  if (bySource.size === 0) {
    const forwardOnly =
      ctx.enabledKinds.size === 1 && ctx.enabledKinds.has("forward")
    return {
      candidates: [],
      scopeCounts,
      emptyReason:
        forwardOnly && ctx.forwardedFilter === "original"
          ? "original_only"
          : "no_candidates",
    }
  }

  const candidates: DiscoveryCandidate[] = [...bySource.entries()].map(
    ([handle, entry]) => {
      const seenIn: DiscoverySeenIn[] = [...entry.byCarrier.entries()]
        .map(([channelName, counts]) => ({
          channelName,
          counts,
          total: sumCounts(counts),
        }))
        .sort((a, b) => {
          if (b.total !== a.total) return b.total - a.total
          return a.channelName.localeCompare(b.channelName)
        })

      return {
        name: entry.canonicalName,
        displayName: entry.displayName,
        counts: entry.counts,
        total: sumCounts(entry.counts),
        seenIn,
        seenInCount: seenIn.length,
        lastSeen: entry.lastSeen,
        isFollowed: followed.has(handle),
        samplePost: {
          channelName: entry.samplePost.channelName,
          postId: entry.samplePost.id,
          timestamp: entry.samplePost.timestamp,
        },
      }
    },
  )

  return {
    candidates: sortDiscoveryCandidates(candidates, "total"),
    scopeCounts,
  }
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

/* -------------------------------------------------------------------------- */
/* Scope summary                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Post-level counts for the scope card. `computeDiscoveryCandidates` returns
 * these as part of its single pass; this standalone form is only for the
 * degenerate case where no signals are enabled (and for tests).
 */
export function countPostsBySignal(posts: Post[]): DiscoveryScopeCounts {
  let forwardPosts = 0
  let mentionPosts = 0
  let linkPosts = 0

  for (const post of posts) {
    const refs = postReferences(post)
    if (refs.size === 0) continue
    let hasForward = false
    let hasMention = false
    let hasLink = false
    for (const kinds of refs.values()) {
      if (kinds.has("forward")) hasForward = true
      if (kinds.has("mention")) hasMention = true
      if (kinds.has("link")) hasLink = true
    }
    if (hasForward) forwardPosts += 1
    if (hasMention) mentionPosts += 1
    if (hasLink) linkPosts += 1
  }

  return { forwardPosts, mentionPosts, linkPosts }
}

export function countUnfollowedCandidates(
  candidates: DiscoveryCandidate[],
): number {
  return candidates.filter((candidate) => !candidate.isFollowed).length
}
