import { toast } from "sonner"

import {
  addManualTag,
  getTagNames,
  removeTagsByName,
} from "@/lib/channels/channel-tag-model"
import { isVirtualGroupTag } from "@/lib/channels/virtual-group-tags"
import type { CommandContext } from "@/lib/commands/types"
import { upsertChannel } from "@/lib/repository"
import type { Channel } from "@/types"

/** UI-only tag id for the Channels tab pseudo-tag (not stored in DB). */
export const UNTAGGED_TAG_ID = "__ui_untagged__"
export const UNTAGGED_TAG_LABEL = "Untagged"

export function isUntaggedChannel(channel: Channel): boolean {
  return getTagNames(channel.tags).length === 0
}

export function filterUntaggedChannels(channels: Channel[]): Channel[] {
  return channels.filter(isUntaggedChannel)
}

export function isUiUntaggedTag(tag: string): boolean {
  return tag === UNTAGGED_TAG_ID
}

export function collectAllChannelTags(channels: Channel[]): string[] {
  const tags = new Set<string>()
  for (const channel of channels) {
    getTagNames(channel.tags).forEach((tag) => tags.add(tag))
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b))
}

/** Case-insensitive substring filter for the Channels tab tag chip bar. */
export function filterTagsBySearch(tags: string[], query: string): string[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return tags
  return tags.filter((tag) => tag.toLowerCase().includes(normalized))
}

type TagSelectionGroup = "fully" | "partial" | "none"

function getTagSelectionGroup(
  selectedCount: number,
  channelCount: number,
): TagSelectionGroup {
  if (selectedCount > 0 && selectedCount === channelCount) return "fully"
  if (selectedCount > 0) return "partial"
  return "none"
}

const TAG_SELECTION_GROUP_ORDER: Record<TagSelectionGroup, number> = {
  fully: 0,
  partial: 1,
  none: 2,
}

/** Sort tags for the Channels tab tag bar: group by selection state, then by channel count and selection count (desc). */
export function sortTagsForChannelGrid(
  tags: string[],
  channels: Channel[],
  selectedChannels: Set<string>,
): string[] {
  const stats = tags.map((tag) => {
    const channelsWithTag = channels.filter((channel) =>
      getTagNames(channel.tags).includes(tag),
    )
    const channelCount = channelsWithTag.length
    const selectedCount = channelsWithTag.filter((channel) =>
      selectedChannels.has(channel.name),
    ).length
    return {
      tag,
      channelCount,
      selectedCount,
      group: getTagSelectionGroup(selectedCount, channelCount),
    }
  })

  return stats
    .sort((a, b) => {
      const groupDiff =
        TAG_SELECTION_GROUP_ORDER[a.group] - TAG_SELECTION_GROUP_ORDER[b.group]
      if (groupDiff !== 0) return groupDiff
      if (b.channelCount !== a.channelCount)
        return b.channelCount - a.channelCount
      if (b.selectedCount !== a.selectedCount)
        return b.selectedCount - a.selectedCount
      return a.tag.localeCompare(b.tag)
    })
    .map((entry) => entry.tag)
}

export function filterChannelsByTag(
  channels: Channel[],
  tag: string,
): Channel[] {
  if (isUiUntaggedTag(tag)) return filterUntaggedChannels(channels)
  const normalized = tag.trim().toLowerCase()
  if (!normalized) return []
  return channels.filter((channel) => {
    const names = getTagNames(channel.tags)
    return names.some((entry) => entry.toLowerCase() === normalized)
  })
}

export async function addTagToChannel(
  channel: Channel,
  rawTag: string,
  ctx: CommandContext,
): Promise<void> {
  const tag = rawTag.trim()
  if (!tag) {
    toast.error("Enter a tag name")
    return
  }
  if (isVirtualGroupTag(tag)) {
    toast.error('Tags starting with "group:" are reserved for setting groups')
    return
  }
  const newTags = addManualTag(channel.tags, tag)
  const updated = { ...channel, tags: newTags }
  await upsertChannel(updated)
  ctx.setChannels((prev) =>
    prev.map((entry) => (entry.id === channel.id ? updated : entry)),
  )
  toast.success(`Added tag "${tag}" to @${channel.name}`)
}

export async function removeTagFromChannel(
  channel: Channel,
  tag: string,
  ctx: CommandContext,
): Promise<void> {
  const newTags = removeTagsByName(channel.tags, [tag])
  const updated = { ...channel, tags: newTags }
  await upsertChannel(updated)
  ctx.setChannels((prev) =>
    prev.map((entry) => (entry.id === channel.id ? updated : entry)),
  )
  toast.success(`Removed tag "${tag}" from @${channel.name}`)
}

export function selectChannelsByTag(tag: string, ctx: CommandContext): void {
  const matching = filterChannelsByTag(ctx.channels, tag)
  if (matching.length === 0) {
    toast.info(`No channels found with tag "${tag.trim()}"`)
    return
  }
  ctx.setSelectedChannels(new Set(matching.map((channel) => channel.name)))
  toast.success(
    `Selected ${matching.length} channel(s) with tag "${tag.trim()}"`,
  )
}
