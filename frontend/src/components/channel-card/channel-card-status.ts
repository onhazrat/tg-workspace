import { findFrozenReservedGroup } from "@/lib/channels/setting-groups"
import { toVirtualGroupTagName } from "@/lib/channels/virtual-group-tags"
import type { Channel, ChannelSettingGroup, ChannelStats } from "@/types"

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

/**
 * The group a freeze toggle moves the channel into: the reserved Frozen group
 * to freeze, the default group to thaw. `undefined` when that group is missing,
 * and the toggle then does nothing.
 */
export function freezeTargetGroup(
  channel: Channel,
  groups: ChannelSettingGroup[],
): ChannelSettingGroup | undefined {
  return channel.isFrozen
    ? groups.find((group) => group.isDefault)
    : findFrozenReservedGroup(groups)
}

/** 1-based place in the sync queue, or null when the channel is not queued. */
export function queuePosition(
  queue: { channel: Pick<Channel, "id"> }[],
  channelId: string,
): number | null {
  const index = queue.findIndex((item) => item.channel.id === channelId)
  return index === -1 ? null : index + 1
}

/** The card frame: dimmed when frozen, outlined when selected, ringed while syncing. */
export function channelCardFrameClass({
  isFrozen,
  isSelected,
  isScraping,
}: {
  isFrozen: boolean | undefined
  isSelected: boolean
  isScraping: boolean
}): string {
  return `relative flex flex-col h-full rounded-2xl border transition-all duration-200 overflow-hidden group
        ${isFrozen ? "opacity-80" : ""}
        ${
          isSelected
            ? "bg-app-card border-app-ink shadow-md"
            : "bg-app-card border-app-ink/10 shadow-sm hover:border-app-ink/30 hover:shadow-md"
        }
        ${isScraping ? "ring-2 ring-app-ink/20" : ""}
      `
}

/** The setting group as a virtual tag, and the hint naming where settings come from. */
export function settingGroupHints(settingGroupName: string | undefined): {
  virtualGroupTagName: string | null
  inheritedSettingsHint: string
} {
  if (!settingGroupName)
    return {
      virtualGroupTagName: null,
      inheritedSettingsHint: "Inherited from channel setting group",
    }
  return {
    virtualGroupTagName: toVirtualGroupTagName(settingGroupName),
    inheritedSettingsHint: `Inherited from setting group "${settingGroupName}"`,
  }
}
