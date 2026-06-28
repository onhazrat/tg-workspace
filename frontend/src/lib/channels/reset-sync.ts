import { toast } from "sonner"

import { api } from "@/api"
import { filterPartialHistoryChannels } from "@/lib/commands/filter-channels"
import type { CommandContext } from "@/lib/commands/types"
import { clearChannelPosts } from "@/lib/repository"
import type { Channel } from "@/types"

export async function resetAndSyncChannel(
  channel: Channel,
  ctx: CommandContext,
): Promise<void> {
  try {
    await api.bulkResetSync({
      confirm: true,
      channelIds: [channel.id],
    })
    await clearChannelPosts(channel.name)
    await ctx.loadChannels()
    toast.success(`Reset & sync queued for @${channel.name}`)
  } catch (err) {
    console.error("Reset & sync failed:", err)
    await clearChannelPosts(channel.name)
    ctx.addToSyncQueue(channel, "Manual (Reset & Sync)", () => {})
    toast.warning(`Reset failed for @${channel.name}; sync queued as fallback`)
  }
}

export async function bulkResetSyncAllChannels(
  ctx: CommandContext,
): Promise<void> {
  const result = await api.bulkResetSync({ confirm: true })
  await ctx.loadChannels()
  toast.success(
    `Reset ${result.channelsReset} channel(s); deleted ${result.postsDeleted} post(s).` +
      (result.errors.length ? ` ${result.errors.length} error(s).` : ""),
  )
}

export async function bulkResetSyncPartialHistoryChannels(
  ctx: CommandContext,
): Promise<void> {
  const channelIds = filterPartialHistoryChannels(ctx.channels).map(
    (channel) => channel.id,
  )
  if (channelIds.length === 0) {
    toast.info("No channels with partial history")
    return
  }

  const result = await api.bulkResetSync({
    confirm: true,
    channelIds,
  })
  await ctx.loadChannels()
  toast.success(
    `Queued reset & sync for ${result.channelsReset} channel(s) with partial history.` +
      (result.errors.length ? ` ${result.errors.length} error(s).` : ""),
  )
}
