import type { CommandContext } from "@/lib/commands/types"
import { clearChannelPosts, deleteChannel } from "@/lib/repository"
import type { Channel } from "@/types"

export interface DeleteChannelContext
  extends Pick<
    CommandContext,
    "setSelectedChannels" | "loadChannels" | "loadDBStats"
  > {}

export async function deleteChannelByRecord(
  channel: Channel,
  ctx: DeleteChannelContext,
): Promise<void> {
  await deleteChannel(channel.id)
  await clearChannelPosts(channel.name)
  await ctx.loadChannels()
  await ctx.loadDBStats?.()
  ctx.setSelectedChannels((prev) => {
    const next = new Set(prev)
    next.delete(channel.name)
    return next
  })
}
