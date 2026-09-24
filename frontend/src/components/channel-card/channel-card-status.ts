import type { Channel, ChannelStats } from "@/types"

/** Percent of the channel's newest post the local copy has reached, or null when unknown. */
export function syncProgress(stats: ChannelStats | undefined): number | null {
  if (!stats?.latestId || !stats.maxId) return null
  return (stats.maxId / stats.latestId) * 100
}

export interface ChannelSyncStatus {
  label: string
  dotClass: string
}

export function channelSyncStatus(
  channel: Channel,
  stats: ChannelStats | undefined,
): ChannelSyncStatus {
  if (channel.isUnavailableOnWebView)
    return { label: "Restricted", dotClass: "bg-red-500" }
  if (channel.isFrozen) return { label: "Frozen", dotClass: "bg-blue-500" }
  const progress = syncProgress(stats)
  if (progress !== null && progress >= 100)
    return { label: "Up to date", dotClass: "bg-emerald-500" }
  return { label: "Pending", dotClass: "bg-amber-500 animate-pulse" }
}

/** A typed Start ID, or null when the input is not a positive integer. */
export function parseStartId(input: string): number | null {
  const n = parseInt(input, 10)
  return Number.isNaN(n) || n <= 0 ? null : n
}
