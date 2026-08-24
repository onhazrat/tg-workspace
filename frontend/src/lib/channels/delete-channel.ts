import { ApiError } from "@/api/base"
import type { CommandContext } from "@/lib/commands/types"
import type { Channel } from "@/types"
import { deleteChannel } from "./store"

export interface DeleteChannelContext
  extends Pick<
    CommandContext,
    "setSelectedChannels" | "loadChannels" | "loadDBStats"
  > {}

/**
 * Remove a channel from this account's list.
 *
 * A 404 is swallowed because removal asks for a state — "not on my list" — that
 * a 404 says is already true. The server answers 404 rather than 403 for a
 * channel you do not follow, and until ticket 15 scopes the channel list this
 * is reachable by ordinary means: the grid still shows channels the account
 * does not follow, and a removed one stays on it until retention collects it,
 * so a second click on the same card is a normal thing to do. Every other
 * status still throws.
 */
export async function deleteChannelByRecord(
  channel: Channel,
  ctx: DeleteChannelContext,
  remove: (id: string) => Promise<void> = deleteChannel,
): Promise<void> {
  try {
    await remove(channel.id)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
  }
  await ctx.loadChannels()
  await ctx.loadDBStats?.()
  ctx.setSelectedChannels((prev) => {
    const next = new Set(prev)
    next.delete(channel.name)
    return next
  })
}
