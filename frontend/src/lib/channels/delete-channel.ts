import type { CommandContext } from "@/lib/commands/types"
import type { Channel } from "@/types"
import { deleteChannel } from "./store"

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
  await ctx.loadChannels()
  await ctx.loadDBStats?.()
  ctx.setSelectedChannels((prev) => {
    const next = new Set(prev)
    next.delete(channel.name)
    return next
  })
}
