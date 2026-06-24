import { toast } from "sonner"

import type { CommandContext } from "@/lib/commands/types"
import { upsertChannel } from "@/lib/repository"
import type { Channel } from "@/types"

export async function updateChannelStartId(
  channel: Channel,
  rawValue: string,
  ctx: CommandContext,
): Promise<void> {
  const newStartId = Number.parseInt(rawValue.trim(), 10)
  if (Number.isNaN(newStartId) || newStartId <= 0) {
    toast.error("Enter a positive message ID")
    return
  }
  const updated = { ...channel, startId: newStartId }
  await upsertChannel(updated)
  ctx.setChannels((prev) =>
    prev.map((entry) => (entry.id === channel.id ? updated : entry)),
  )
  toast.success(`Start message ID set to ${newStartId} for @${channel.name}`)
}
