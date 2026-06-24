import { toast } from "sonner"

import { deleteChannelByRecord } from "@/lib/channels/delete-channel"
import type { CommandContext } from "@/lib/commands/types"

export async function deleteSelectedChannels(
  ctx: CommandContext,
): Promise<void> {
  const names = Array.from(ctx.selectedChannels)
  let deleted = 0
  for (const name of names) {
    const channel = ctx.channels.find((entry) => entry.name === name)
    if (!channel) continue
    await deleteChannelByRecord(channel, ctx)
    deleted += 1
  }
  ctx.setSelectedChannels(new Set())
  toast.success(
    deleted === 1 ? "Deleted 1 channel" : `Deleted ${deleted} channels`,
  )
}
