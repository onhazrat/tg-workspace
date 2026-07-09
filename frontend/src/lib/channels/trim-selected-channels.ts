import { toast } from "sonner"

import type { Channel, ChannelStats } from "@/types"

import {
  CHANNEL_GRID_SORT_LABELS,
  type ChannelGridSortOption,
  sortChannelsForGrid,
} from "./sort-channels-for-grid"

export type TrimSelectedChannelsResult =
  | {
      status: "applied"
      previousCount: number
      nextCount: number
      keptNames: string[]
    }
  | {
      status: "noop"
      reason: "empty_selection" | "already_within_limit" | "invalid_count"
      selectedCount: number
    }

export type TrimSelectedChannelsParams = {
  channels: Channel[]
  channelStats: Record<string, ChannelStats>
  postsInScopeCounts?: Record<string, number>
  selectedChannels: Set<string>
  sortBy: ChannelGridSortOption
  sortDirection: "asc" | "desc"
  count: number
}

export function trimSelectedChannelsToCount({
  channels,
  channelStats,
  postsInScopeCounts,
  selectedChannels,
  sortBy,
  sortDirection,
  count,
}: TrimSelectedChannelsParams): TrimSelectedChannelsResult {
  const selectedCount = selectedChannels.size
  if (selectedCount === 0) {
    return { status: "noop", reason: "empty_selection", selectedCount }
  }
  if (!Number.isFinite(count) || count < 1) {
    return { status: "noop", reason: "invalid_count", selectedCount }
  }

  const candidates = channels.filter((channel) =>
    selectedChannels.has(channel.name),
  )
  const sorted = sortChannelsForGrid({
    channels: candidates,
    channelStats,
    postsInScopeCounts,
    selectedChannels,
    sortBy,
    sortDirection,
  })

  if (count >= sorted.length) {
    return {
      status: "noop",
      reason: "already_within_limit",
      selectedCount: sorted.length,
    }
  }

  const keptNames = sorted.slice(0, count).map((channel) => channel.name)
  return {
    status: "applied",
    previousCount: sorted.length,
    nextCount: keptNames.length,
    keptNames,
  }
}

export function notifyTrimChannelSelectionResult(
  result: TrimSelectedChannelsResult,
  sortBy: ChannelGridSortOption,
  sortDirection: "asc" | "desc",
): void {
  if (result.status === "applied") {
    const sortLabel = CHANNEL_GRID_SORT_LABELS[sortBy]
    const directionLabel = sortDirection === "asc" ? "ascending" : "descending"
    toast.success(
      `Trimmed selection from ${result.previousCount} → ${result.nextCount} (${sortLabel}, ${directionLabel})`,
    )
    return
  }
  if (result.reason === "already_within_limit") {
    toast.info(`Already ${result.selectedCount} or fewer selected`)
  }
}

export type ApplyTrimChannelSelectionParams = TrimSelectedChannelsParams & {
  setSelectedChannels: (value: Set<string>) => void
}

export function applyTrimChannelSelection({
  setSelectedChannels,
  ...params
}: ApplyTrimChannelSelectionParams): TrimSelectedChannelsResult {
  const result = trimSelectedChannelsToCount(params)
  if (result.status === "applied") {
    setSelectedChannels(new Set(result.keptNames))
  }
  notifyTrimChannelSelectionResult(result, params.sortBy, params.sortDirection)
  return result
}
