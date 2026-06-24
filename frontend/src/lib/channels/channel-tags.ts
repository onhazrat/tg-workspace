import { toast } from "sonner"

import type { CommandContext } from "@/lib/commands/types"
import { upsertChannel } from "@/lib/repository"
import type { Channel } from "@/types"

export function collectAllChannelTags(channels: Channel[]): string[] {
  const tags = new Set<string>()
  for (const channel of channels) {
    channel.tags?.forEach((tag) => tags.add(tag))
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b))
}

export function filterChannelsByTag(
  channels: Channel[],
  tag: string,
): Channel[] {
  const normalized = tag.trim().toLowerCase()
  if (!normalized) return []
  return channels.filter((channel) =>
    channel.tags?.some((entry) => entry.toLowerCase() === normalized),
  )
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
  const newTags = Array.from(new Set([...(channel.tags || []), tag]))
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
  const newTags = (channel.tags || []).filter((entry) => entry !== tag)
  const updated = { ...channel, tags: newTags }
  await upsertChannel(updated)
  ctx.setChannels((prev) =>
    prev.map((entry) => (entry.id === channel.id ? updated : entry)),
  )
  toast.success(`Removed tag "${tag}" from @${channel.name}`)
}

export function selectChannelsByTag(tag: string, ctx: CommandContext): void {
  const matching = filterChannelsByTag(ctx.channels, tag).filter(
    (channel) => !channel.isFrozen,
  )
  if (matching.length === 0) {
    toast.info(`No channels found with tag "${tag.trim()}"`)
    return
  }
  ctx.setSelectedChannels(new Set(matching.map((channel) => channel.name)))
  toast.success(
    `Selected ${matching.length} channel(s) with tag "${tag.trim()}"`,
  )
}
