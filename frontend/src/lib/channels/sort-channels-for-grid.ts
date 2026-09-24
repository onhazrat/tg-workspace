import { scopedStorage } from "@/lib/storage/scoped"
import type { Channel, ChannelStats, Post } from "@/types"

export type ChannelGridSortOption =
  | "activity_rate"
  | "total_posts"
  | "posts_in_scope"
  | "last_updated"
  | "channel_id"
  | "channel_name"
  | "followed_at"
  | "subscribers"
  | "next_regular_sync"
  | "next_dynamic_sync"
  | "next_auto_sync"

export const CHANNEL_GRID_SORT_LABELS: Record<ChannelGridSortOption, string> = {
  activity_rate: "Activity Rate",
  total_posts: "Total Posts",
  posts_in_scope: "Posts in Scope",
  last_updated: "Last Updated",
  channel_id: "Channel ID",
  channel_name: "Channel Name",
  followed_at: "Followed At",
  subscribers: "Subscribers",
  next_regular_sync: "Next Regular Sync",
  next_dynamic_sync: "Next Dynamic Sync",
  next_auto_sync: "Next Auto Sync",
}

const DEFAULT_SORT_BY: ChannelGridSortOption = "last_updated"
const DEFAULT_SORT_DIRECTION: "asc" | "desc" = "desc"

export function getChannelGridSortFromStorage(): {
  sortBy: ChannelGridSortOption
  sortDirection: "asc" | "desc"
} {
  const savedSortBy = scopedStorage.getItem("channelGrid_sortBy")
  const savedSortDirection = scopedStorage.getItem("channelGrid_sortDirection")
  const sortBy = (savedSortBy as ChannelGridSortOption) || DEFAULT_SORT_BY
  const sortDirection =
    (savedSortDirection as "asc" | "desc") || DEFAULT_SORT_DIRECTION
  return { sortBy, sortDirection }
}

const compareNullableSyncAt = (
  a: number | null | undefined,
  b: number | null | undefined,
): number => {
  const aVal = a ?? null
  const bVal = b ?? null
  if (aVal === null && bVal === null) return 0
  if (aVal === null) return 1
  if (bVal === null) return -1
  return aVal - bVal
}

const getNextAutoSyncAt = (channel: Channel): number | null => {
  const deadlines: number[] = []
  if (channel.regularSyncEnabled ?? true) {
    if (channel.nextRegularSyncAt != null) {
      deadlines.push(channel.nextRegularSyncAt)
    }
  }
  if (channel.dynamicSyncEnabled) {
    if (channel.nextDynamicSyncAt != null) {
      deadlines.push(channel.nextDynamicSyncAt)
    }
  }
  if (deadlines.length === 0) return null
  return Math.min(...deadlines)
}

const getSelectionTier = (
  channel: Channel,
  selectedChannels: Set<string>,
): number => {
  if (channel.isFrozen) return 3
  if (selectedChannels.has(channel.name)) return 1
  return 2
}

export function buildPostsInScopeCounts(
  filteredPosts: Post[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const post of filteredPosts) {
    counts[post.channelName] = (counts[post.channelName] ?? 0) + 1
  }
  return counts
}

type SortInputs = {
  channelStats: Record<string, ChannelStats>
  postsInScopeCounts: Record<string, number>
}

type ChannelComparator = (a: Channel, b: Channel, inputs: SortInputs) => number

const SORT_COMPARATORS: Record<ChannelGridSortOption, ChannelComparator> = {
  activity_rate: (a, b, { channelStats }) =>
    (channelStats[a.name]?.velocity || 0) -
    (channelStats[b.name]?.velocity || 0),
  total_posts: (a, b, { channelStats }) =>
    (channelStats[a.name]?.count || 0) - (channelStats[b.name]?.count || 0),
  posts_in_scope: (a, b, { postsInScopeCounts }) =>
    (postsInScopeCounts[a.name] ?? 0) - (postsInScopeCounts[b.name] ?? 0),
  last_updated: (a, b) => (a.lastUpdated || 0) - (b.lastUpdated || 0),
  followed_at: (a, b) => (a.followedAt || 0) - (b.followedAt || 0),
  channel_id: (a, b) => (a.startId || 0) - (b.startId || 0),
  channel_name: (a, b) =>
    (a.displayName || a.name).localeCompare(b.displayName || b.name),
  // An unknown count sorts as 0 here, which is this grid's long-standing
  // behaviour and reasonable given its asc/desc toggle. The Discover ranking
  // deliberately differs — it pushes unknowns to the end in either direction
  // (see `sortDiscoveryCandidates`) — because a freshly generated report is
  // normally half unprobed, so zeros would dominate the top or the bottom.
  subscribers: (a, b) => (a.subscribers ?? 0) - (b.subscribers ?? 0),
  next_regular_sync: (a, b) =>
    compareNullableSyncAt(a.nextRegularSyncAt, b.nextRegularSyncAt),
  next_dynamic_sync: (a, b) =>
    compareNullableSyncAt(a.nextDynamicSyncAt, b.nextDynamicSyncAt),
  next_auto_sync: (a, b) =>
    compareNullableSyncAt(getNextAutoSyncAt(a), getNextAutoSyncAt(b)),
}

const compareBySortOption = (
  a: Channel,
  b: Channel,
  inputs: SortInputs,
  sortBy: ChannelGridSortOption,
): number =>
  // `sortBy` can come from storage unchecked, so an unknown value (or an
  // inherited key like "constructor") compares equal rather than calling it.
  Object.hasOwn(SORT_COMPARATORS, sortBy)
    ? SORT_COMPARATORS[sortBy](a, b, inputs)
    : 0

export type SortChannelsForGridParams = {
  channels: Channel[]
  channelStats: Record<string, ChannelStats>
  postsInScopeCounts?: Record<string, number>
  selectedChannels: Set<string>
  sortBy: ChannelGridSortOption
  sortDirection: "asc" | "desc"
}

export function sortChannelsForGrid({
  channels,
  channelStats,
  postsInScopeCounts = {},
  selectedChannels,
  sortBy,
  sortDirection,
}: SortChannelsForGridParams): Channel[] {
  return [...channels].sort((a, b) => {
    const aGroup = getSelectionTier(a, selectedChannels)
    const bGroup = getSelectionTier(b, selectedChannels)

    if (aGroup !== bGroup) {
      return aGroup - bGroup
    }

    let comparison = compareBySortOption(
      a,
      b,
      { channelStats, postsInScopeCounts },
      sortBy,
    )
    if (comparison === 0) {
      const aName = a.displayName || a.name
      const bName = b.displayName || b.name
      comparison = aName.localeCompare(bName)
    }

    return sortDirection === "asc" ? comparison : -comparison
  })
}
