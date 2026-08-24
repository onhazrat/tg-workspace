import { toast } from "sonner"

import { deleteChannelByRecord } from "@/lib/channels/delete-channel"
import type { CommandContext } from "@/lib/commands/types"

export async function deleteSelectedChannels(
  ctx: CommandContext,
  remove?: (id: string) => Promise<void>,
): Promise<void> {
  const names = Array.from(ctx.selectedChannels)
  let deleted = 0
  let failed = 0
  for (const name of names) {
    const channel = ctx.channels.find((entry) => entry.name === name)
    if (!channel) continue
    // Per channel, so one failure does not strand the rest of the selection.
    // Before this the loop let the rejection escape: the remaining channels
    // were never removed, the selection was never cleared, and no toast fired,
    // which reads as the whole action having done nothing.
    try {
      await deleteChannelByRecord(channel, ctx, remove)
      deleted += 1
    } catch {
      failed += 1
    }
  }
  ctx.setSelectedChannels(new Set())
  if (deleted > 0) {
    toast.success(
      deleted === 1 ? "Removed 1 channel" : `Removed ${deleted} channels`,
    )
  }
  if (failed > 0) {
    toast.error(
      failed === 1
        ? "1 channel could not be removed"
        : `${failed} channels could not be removed`,
    )
  }
}
