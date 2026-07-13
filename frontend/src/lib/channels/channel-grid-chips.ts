import { getTagNames } from "@/lib/channels/channel-tag-model"
import { sortTagsForChannelGrid } from "@/lib/channels/channel-tags"
import type { Channel } from "@/types"

export type ChipSelectionState = {
  selectedCount: number
  totalCount: number
  isAllSelected: boolean
  isPartial: boolean
}

/**
 * Selection state for a chip (group, tag, or untagged) over a list of
 * channel names. `isAllSelected` requires at least one channel, matching the
 * chip highlight semantics on the Channels tab.
 */
export function getChipSelectionState(
  names: string[],
  selectedChannels: Set<string>,
): ChipSelectionState {
  const selectedCount = names.filter((name) =>
    selectedChannels.has(name),
  ).length
  return {
    selectedCount,
    totalCount: names.length,
    isAllSelected: selectedCount === names.length && names.length > 0,
    isPartial: selectedCount > 0 && selectedCount < names.length,
  }
}

/**
 * Plain "every name selected" check used by chip toggling. Unlike
 * `getChipSelectionState().isAllSelected`, this is true for an empty list,
 * preserving the historical toggle behavior (a no-op deselect).
 */
export function areAllNamesSelected(
  names: string[],
  selectedChannels: Set<string>,
): boolean {
  return names.every((name) => selectedChannels.has(name))
}

/**
 * Toggle a chip's channels in a selection set: if every name was already
 * selected, remove them all; otherwise add them all.
 */
export function toggleNamesInSelection(
  prev: Set<string>,
  names: string[],
  allSelected: boolean,
): Set<string> {
  const next = new Set(prev)
  if (allSelected) {
    names.forEach((name) => next.delete(name))
  } else {
    names.forEach((name) => next.add(name))
  }
  return next
}

type NameFilterOptions = {
  excludeFrozen?: boolean
}

/** Names of channels carrying a tag. Chip counts include frozen channels; toggling excludes them. */
export function getChannelNamesWithTag(
  channels: Channel[],
  tag: string,
  { excludeFrozen = false }: NameFilterOptions = {},
): string[] {
  return channels
    .filter(
      (c) =>
        getTagNames(c.tags).includes(tag) && (!excludeFrozen || !c.isFrozen),
    )
    .map((c) => c.name)
}

/** Names of channels in a setting group. Chip counts include frozen channels; toggling excludes them. */
export function getChannelNamesInGroup(
  channels: Channel[],
  groupId: string,
  { excludeFrozen = false }: NameFilterOptions = {},
): string[] {
  return channels
    .filter(
      (channel) =>
        channel.settingGroupId === groupId &&
        (!excludeFrozen || !channel.isFrozen),
    )
    .map((channel) => channel.name)
}

/** Unique tags across all channels, ordered for the Channels tab chip bar. */
export function collectGridTags(
  channels: Channel[],
  selectedChannels: Set<string>,
): string[] {
  const tags = new Set<string>()
  channels.forEach((c) => {
    getTagNames(c.tags).forEach((t) => tags.add(t))
  })
  return sortTagsForChannelGrid(Array.from(tags), channels, selectedChannels)
}
