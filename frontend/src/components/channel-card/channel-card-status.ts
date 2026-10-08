import { shortcut } from "@/lib/channels/card-zoom"
import { findFrozenReservedGroup } from "@/lib/channels/setting-groups"
import { channelAllows } from "@/lib/channels/sync-permissions"
import { toVirtualGroupTagName } from "@/lib/channels/virtual-group-tags"
import type { Channel, ChannelSettingGroup, ChannelStats } from "@/types"

/** Percent of the channel's newest post the local copy has reached, or null when unknown. */
export function syncProgress(stats: ChannelStats | undefined): number | null {
  if (!stats?.latestId || !stats.maxId) return null
  return (stats.maxId / stats.latestId) * 100
}

export interface ChannelSyncStatus {
  label: "Restricted" | "Frozen"
  dotClass: string
  textClass: string
}

/**
 * The card's status label, only for states that are always true. "Up to date"
 * and "Pending" are gone: they compared against a newest post id only this
 * browser tab remembers, so every card read "Pending" after a reload.
 */
export function channelSyncStatus(channel: Channel): ChannelSyncStatus | null {
  if (channel.isUnavailableOnWebView)
    return {
      label: "Restricted",
      dotClass: "bg-red-500",
      textClass: "text-red-600",
    }
  if (channel.isFrozen)
    return {
      label: "Frozen",
      dotClass: "bg-blue-500",
      textClass: "text-blue-600",
    }
  return null
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

/** The accessible name of whatever toggles a channel's selection. */
export function selectLabel(channelName: string, isSelected: boolean): string {
  return isSelected ? `Deselect ${channelName}` : `Select ${channelName}`
}

/**
 * Click handlers for whatever toggles a channel's selection, passing on
 * whether shift was held. A shift-press would otherwise extend the page's text
 * selection to the control, so the press is swallowed here, on the selection
 * controls only, and tag and Start ID text stays selectable.
 */
export function selectionHandlers(onToggleSelected: (shift: boolean) => void) {
  return {
    onClick: (event: { shiftKey: boolean }) => onToggleSelected(event.shiftKey),
    onMouseDown: (event: { shiftKey: boolean; preventDefault: () => void }) => {
      if (event.shiftKey) event.preventDefault()
    },
  }
}

/**
 * What every size's Sync button shares: `s` presses it, a click stays off the
 * card under it, the Channel's own sync rule disables it, and an unavailable
 * Channel offers Recheck instead.
 */
export function syncButtonProps(
  channel: Channel,
  busy: boolean,
  onSync: () => void,
) {
  return {
    ...shortcut("s"),
    label: channel.isUnavailableOnWebView ? "Recheck" : "Sync",
    disabled: busy || !channelAllows(channel, "individual"),
    onClick: (event: { stopPropagation: () => void }) => {
      event.stopPropagation()
      onSync()
    },
  }
}

/**
 * The six sections a card and a detailed card share with the cards beside
 * them: header, bio, tiles, tags, About and footer. The card spans one track
 * of its grid row per section and takes them as a subgrid, so the tallest bio
 * in a row sets that row's bio track and each section starts level with its
 * neighbours'. A section a card lacks is an empty track, never a missing one.
 */
export const ALIGNED_SECTIONS_CLASS = "row-span-6 grid grid-rows-subgrid"

/**
 * The card frame: dimmed when frozen, outlined when selected, ringed while
 * syncing, and ringed blue, over the syncing ring, while keyboard mode
 * highlights it.
 */
export function channelCardFrameClass({
  isFrozen,
  isSelected,
  isScraping,
  highlighted = false,
  aligned = false,
}: {
  isFrozen: boolean | undefined
  isSelected: boolean
  isScraping: boolean
  highlighted?: boolean
  /** Lines its sections up with the row's other cards; see above. */
  aligned?: boolean
}): string {
  return `relative ${aligned ? ALIGNED_SECTIONS_CLASS : "flex flex-col h-full"} rounded-2xl border transition-all duration-200 overflow-hidden group
        ${isFrozen ? "opacity-80" : ""}
        ${
          isSelected
            ? "bg-app-card border-app-ink shadow-md"
            : "bg-app-card border-app-ink/10 shadow-sm hover:border-app-ink/30 hover:shadow-md"
        }
        ${
          highlighted
            ? "ring-2 ring-blue-500 border-transparent"
            : isScraping
              ? "ring-2 ring-app-ink/20"
              : ""
        }
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
