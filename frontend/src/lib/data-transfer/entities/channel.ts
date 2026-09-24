import { api } from "@/api"
import {
  type ChannelsApi,
  listChannels,
  upsertChannel,
} from "@/lib/channels/store"
import type { CommandContext } from "@/lib/commands/types"
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

export function filterChannelsWithTelegramChatId(
  channels: Channel[],
): Channel[] {
  return filterChannelsAll(
    channels.filter((channel) => channel.telegramChatId != null),
  )
}

export function channelToTelegramChatIdCopyLine(channel: Channel): string {
  return String(channel.telegramChatId)
}

export function channelsToTelegramChatIdsCopyText(channels: Channel[]): string {
  return filterChannelsWithTelegramChatId(channels)
    .map(channelToTelegramChatIdCopyLine)
    .join("\n")
}

export function channelToNameAndTelegramChatIdTsvLine(
  channel: Channel,
): string {
  return `${channel.name}\t${channel.telegramChatId}`
}

export function channelsToNameAndTelegramChatIdTsvText(
  channels: Channel[],
): string {
  return filterChannelsWithTelegramChatId(channels)
    .map(channelToNameAndTelegramChatIdTsvLine)
    .join("\n")
}

export async function listChannelsWithTelegramChatIdForFilter(
  filter: ExportFilter,
  ctx: CommandContext,
): Promise<Channel[]> {
  const channels = await listChannelsForFilter(filter, ctx)
  return filterChannelsWithTelegramChatId(channels)
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

/**
 * What an import writes for `record`. A record that leaves `isFrozen` out keeps
 * the stored value; a Frozen import merges onto the stored row and can only
 * freeze, never thaw.
 */
export function channelImportPayload(
  record: Channel,
  existing: Channel | undefined,
  filter: ExportFilter,
): Channel {
  if (!existing) return { ...record }
  if (filter === "frozen") {
    return {
      ...existing,
      ...record,
      isFrozen: record.isFrozen === true ? true : existing.isFrozen,
    }
  }
  if (record.isFrozen === undefined) {
    return { ...record, isFrozen: existing.isFrozen }
  }
  return { ...record }
}

export async function upsertChannelRecords(
  records: Channel[],
  filter: ExportFilter,
  ctx: CommandContext,
  client: ChannelsApi = api,
): Promise<ImportResult> {
  let imported = 0
  let failed = 0

  for (const record of records) {
    const existing = ctx.channels.find(
      (channel) => channel.id === record.id || channel.name === record.name,
    )
    try {
      await upsertChannel(
        channelImportPayload(record, existing, filter),
        client,
      )
      imported++
    } catch {
      failed++
    }
  }

  try {
    // Refetch and write through, rather than invalidate: an import replaces
    // rows wholesale, so the in-memory list has to be replaced too, and
    // `ctx.setChannels` is the query-cache write-through. The
    // `refreshSyncMeta(true)` that used to follow this only bumped an etag that
    // no longer exists — this read already got the authoritative list.
    const channels = await listChannels(client)
    ctx.setChannels(channels)
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
