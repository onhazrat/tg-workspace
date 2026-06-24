import type { CommandContext } from "@/lib/commands/types"
import { listChannels, refreshSyncMeta, upsertChannel } from "@/lib/repository"
import type { Channel } from "@/types"
import type { DataEntityDef, ExportFilter, ImportResult } from "../types"

export function filterChannelsAll(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) => a.name.localeCompare(b.name))
}

export function filterChannelsSelected(
  channels: Channel[],
  selectedChannels: Set<string>,
): Channel[] {
  return filterChannelsAll(
    channels.filter((channel) => selectedChannels.has(channel.name)),
  )
}

export function filterChannelsFrozen(channels: Channel[]): Channel[] {
  return filterChannelsAll(channels.filter((channel) => channel.isFrozen))
}

export function applyChannelFilter(
  channels: Channel[],
  filter: ExportFilter,
  ctx: CommandContext,
): Channel[] {
  switch (filter) {
    case "all":
      return filterChannelsAll(channels)
    case "selected":
      return filterChannelsSelected(channels, ctx.selectedChannels)
    case "frozen":
      return filterChannelsFrozen(channels)
    default:
      return filterChannelsAll(channels)
  }
}

export async function listChannelsForFilter(
  filter: ExportFilter,
  ctx: CommandContext,
): Promise<Channel[]> {
  let source = ctx.channels
  if (!ctx.isOffline) {
    try {
      source = await listChannels()
    } catch {
      source = ctx.channels
    }
  }
  return applyChannelFilter(source, filter, ctx)
}

export function channelToCopyLine(channel: Channel): string {
  return channel.name
}

export function channelsToCopyText(channels: Channel[]): string {
  return filterChannelsAll(channels).map(channelToCopyLine).join("\n")
}

export function filterChannelImportRecords(
  records: Channel[],
  filter: ExportFilter,
  ctx: CommandContext,
): Channel[] {
  switch (filter) {
    case "selected":
      return records.filter((record) => ctx.selectedChannels.has(record.name))
    case "frozen":
    case "all":
      return records
    default:
      return records
  }
}

export async function upsertChannelRecords(
  records: Channel[],
  filter: ExportFilter,
  ctx: CommandContext,
): Promise<ImportResult> {
  let imported = 0
  let failed = 0

  for (const record of records) {
    try {
      let payload: Channel = { ...record }
      const existing = ctx.channels.find(
        (channel) => channel.id === record.id || channel.name === record.name,
      )

      if (record.isFrozen === undefined && existing) {
        payload = { ...payload, isFrozen: existing.isFrozen }
      }

      if (filter === "frozen" && existing) {
        payload = { ...existing, ...record }
        if (record.isFrozen !== true) {
          payload.isFrozen = existing.isFrozen
        }
      }

      await upsertChannel(payload)
      imported++
    } catch {
      failed++
    }
  }

  try {
    const channels = await listChannels()
    ctx.setChannels(channels)
    await refreshSyncMeta(true)
  } catch {
    /* keep existing in-memory state */
  }

  return { imported, failed, skipped: 0 }
}

export const channelEntityDef: DataEntityDef<"channel"> = {
  entity: "channel",
  singularLabel: "channel",
  pluralLabel: "Channels",
  filters: ["all", "selected", "frozen"],
  listForFilter: listChannelsForFilter,
  toCopyLine: channelToCopyLine,
  filterImportRecords: filterChannelImportRecords,
  upsertRecords: upsertChannelRecords,
}
