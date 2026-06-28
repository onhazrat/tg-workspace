import { toast } from "sonner"

import { api } from "@/api"
import { filterPartialHistoryChannels } from "@/lib/commands/filter-channels"
import type { CommandContext } from "@/lib/commands/types"
import type { Channel } from "@/types"

const BACKFILL_SOURCE = "Backfill Partial History"

export async function backfillSyncChannel(
  channel: Channel,
  ctx: CommandContext,
): Promise<void> {
  ctx.addToSyncQueue(channel, BACKFILL_SOURCE, () => {
    void ctx.loadChannels()
  })
  toast.success(`Backfill sync queued for @${channel.name}`)
}

export async function bulkBackfillPartialHistoryChannels(
  ctx: CommandContext,
): Promise<void> {
  const partial = filterPartialHistoryChannels(ctx.channels)
  const channelIds = partial.map((channel) => channel.id)
  if (channelIds.length === 0) {
    toast.info("No channels with partial history")
    return
  }

  await api.startSyncJob({ channelIds, source: BACKFILL_SOURCE })
  toast.success(
    `Backfill sync queued for ${channelIds.length} channel(s) with partial history`,
  )
}
