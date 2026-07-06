import type { ForwardedFilterValue } from "@/lib/posts/post-view"
import type { Channel, Post } from "@/types"

export interface ForwardSourceCandidate {
  name: string
  displayName?: string
  postCount: number
  forwardedBy: { channelName: string; count: number }[]
  forwardedByCount: number
  lastSeen: number
  isFollowed: boolean
  samplePost: { channelName: string; postId: number; timestamp: number }
}

export type DiscoveryEmptyReason =
  | "original_only"
  | "no_channels_selected"
  | "no_posts_in_scope"
  | "no_forwards_in_scope"
  | "no_unfollowed_sources"
  | "semantic_active"

export interface DiscoveryContext {
  forwardedFilter: ForwardedFilterValue
  selectedChannelCount: number
  semanticQuery?: string
}

function normalizeHandle(name: string): string {
  return name.replace(/^@/, "").trim().toLowerCase()
}

function isChannelFollowed(name: string, channels: Channel[]): boolean {
  const normalized = normalizeHandle(name)
  return channels.some((c) => c.name.toLowerCase() === normalized)
}

function sortForwardedBy(
  entries: { channelName: string; count: number }[],
): { channelName: string; count: number }[] {
  return [...entries].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.channelName.localeCompare(b.channelName)
  })
}

function sortCandidates(
  candidates: ForwardSourceCandidate[],
): ForwardSourceCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.forwardedByCount !== a.forwardedByCount) {
      return b.forwardedByCount - a.forwardedByCount
    }
    if (b.postCount !== a.postCount) return b.postCount - a.postCount
    return b.lastSeen - a.lastSeen
  })
}

export function computeForwardSourceDiscovery(
  filteredPosts: Post[],
  channels: Channel[],
  ctx: DiscoveryContext,
): {
  candidates: ForwardSourceCandidate[]
  emptyReason?: DiscoveryEmptyReason
} {
  if (ctx.forwardedFilter === "original") {
    return { candidates: [], emptyReason: "original_only" }
  }

  if (ctx.selectedChannelCount === 0) {
    return { candidates: [], emptyReason: "no_channels_selected" }
  }

  if (filteredPosts.length === 0) {
    if (ctx.forwardedFilter === "unfollowed_forwarded") {
      return { candidates: [], emptyReason: "no_unfollowed_sources" }
    }
    return { candidates: [], emptyReason: "no_posts_in_scope" }
  }

  const forwardPosts = filteredPosts.filter((post) => !!post.forwardedFrom)

  if (forwardPosts.length === 0) {
    return { candidates: [], emptyReason: "no_forwards_in_scope" }
  }

  type SourceAccumulator = {
    canonicalName: string
    displayName?: string
    forwardedBy: Map<string, number>
    postCount: number
    lastSeen: number
    samplePost: Post
  }

  const bySource = new Map<string, SourceAccumulator>()

  for (const post of forwardPosts) {
    const sourceName = post.forwardedFrom!
    const key = normalizeHandle(sourceName)
    const existing = bySource.get(key)

    if (!existing) {
      bySource.set(key, {
        canonicalName: sourceName.replace(/^@/, "").trim(),
        displayName: post.forwardedFromName,
        forwardedBy: new Map([[post.channelName, 1]]),
        postCount: 1,
        lastSeen: post.timestamp,
        samplePost: post,
      })
      continue
    }

    existing.postCount += 1
    existing.forwardedBy.set(
      post.channelName,
      (existing.forwardedBy.get(post.channelName) ?? 0) + 1,
    )

    if (post.timestamp >= existing.lastSeen) {
      existing.lastSeen = post.timestamp
      existing.samplePost = post
      if (post.forwardedFromName) {
        existing.displayName = post.forwardedFromName
      }
    } else if (!existing.displayName && post.forwardedFromName) {
      existing.displayName = post.forwardedFromName
    }
  }

  let candidates: ForwardSourceCandidate[] = Array.from(bySource.values()).map(
    (entry) => ({
      name: entry.canonicalName,
      displayName: entry.displayName,
      postCount: entry.postCount,
      forwardedBy: sortForwardedBy(
        Array.from(entry.forwardedBy.entries()).map(([channelName, count]) => ({
          channelName,
          count,
        })),
      ),
      forwardedByCount: entry.forwardedBy.size,
      lastSeen: entry.lastSeen,
      isFollowed: isChannelFollowed(entry.canonicalName, channels),
      samplePost: {
        channelName: entry.samplePost.channelName,
        postId: entry.samplePost.id,
        timestamp: entry.samplePost.timestamp,
      },
    }),
  )

  if (ctx.forwardedFilter === "unfollowed_forwarded") {
    candidates = candidates.filter((candidate) => !candidate.isFollowed)
    if (candidates.length === 0) {
      return { candidates: [], emptyReason: "no_unfollowed_sources" }
    }
  }

  return { candidates: sortCandidates(candidates) }
}

export function countForwardPosts(filteredPosts: Post[]): number {
  return filteredPosts.filter((post) => !!post.forwardedFrom).length
}

export function countUnfollowedSources(
  candidates: ForwardSourceCandidate[],
): number {
  return candidates.filter((candidate) => !candidate.isFollowed).length
}
