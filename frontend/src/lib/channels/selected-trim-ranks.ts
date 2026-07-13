import {
  type ChannelGridSortOption,
  sortChannelsForGrid,
} from "@/lib/channels/sort-channels-for-grid"
import type { Channel, ChannelStats } from "@/types"

export type BuildSelectedTrimRanksParams = {
  channels: Channel[]
  channelStats: Record<string, ChannelStats>
  postsInScopeCounts: Record<string, number>
  selectedChannels: Set<string>
  sortBy: ChannelGridSortOption
  sortDirection: "asc" | "desc"
}

/**
 * 1-based rank of each selected channel under the current grid sort order.
 * Only selected channels appear in the map; this is what "Show sort rank"
 * displays on cards and what Trim uses to decide which channels survive.
 */
export function buildSelectedTrimRanks({
  channels,
  channelStats,
  postsInScopeCounts,
  selectedChannels,
  sortBy,
  sortDirection,
}: BuildSelectedTrimRanksParams): Map<string, number> {
  const selected = channels.filter((channel) =>
    selectedChannels.has(channel.name),
  )
  const sorted = sortChannelsForGrid({
    channels: selected,
    channelStats,
    postsInScopeCounts,
    selectedChannels,
    sortBy,
    sortDirection,
  })
  const ranks = new Map<string, number>()
  sorted.forEach((channel, index) => {
    ranks.set(channel.name, index + 1)
  })
  return ranks
}
