import { toast } from "sonner"

import type { CommandContext, CommandDef } from "@/lib/commands/types"
import {
  copyTextToClipboard,
  joinCopyLines,
} from "@/lib/data-transfer/clipboard"
import {
  channelToNameAndTelegramChatIdTsvLine,
  channelToTelegramChatIdCopyLine,
  listChannelsWithTelegramChatIdForFilter,
} from "@/lib/data-transfer/entities/channel"
import type { ExportFilter } from "@/lib/data-transfer/types"
import type { Channel } from "@/types"

const FILTER_LABELS: Record<ExportFilter, string> = {
  all: "All",
  selected: "Selected",
  frozen: "Frozen",
}

function filterKeywords(filter: ExportFilter): string[] {
  switch (filter) {
    case "all":
      return ["all"]
    case "selected":
      return ["selected", "selection"]
    case "frozen":
      return ["frozen", "freeze"]
    default:
      return []
  }
}

function buildDisabledForSelected(ctx: CommandContext) {
  if (ctx.selectedChannels.size === 0) {
    return { disabled: true, reason: "No channels selected" }
  }
  return { disabled: false }
}

function buildDisabledForFrozen(ctx: CommandContext) {
  const frozenCount = ctx.channels.filter((channel) => channel.isFrozen).length
  if (frozenCount === 0) {
    return { disabled: true, reason: "No frozen channels" }
  }
  return { disabled: false }
}

function buildCopyDisabled(filter: ExportFilter, ctx: CommandContext) {
  if (filter === "selected") return buildDisabledForSelected(ctx)
  if (filter === "frozen") return buildDisabledForFrozen(ctx)
  return { disabled: false }
}

function countChannelsWithTelegramChatId(channels: Channel[]): number {
  return channels.filter((channel) => channel.telegramChatId != null).length
}

function emptyTelegramChatIdToast(filter: ExportFilter): void {
  const scope =
    filter === "selected"
      ? "for selected channels"
      : filter === "frozen"
        ? "for frozen channels"
        : ""
  toast.info(
    scope
      ? `No Telegram chat IDs to copy ${scope} — sync channels to populate IDs`
      : "No Telegram chat IDs to copy — sync channels to populate IDs",
  )
}

type TelegramChatIdCopyFormat = "ids" | "name-tsv"

function buildTelegramChatIdCopyCommands(
  format: TelegramChatIdCopyFormat,
): CommandDef[] {
  const commands: CommandDef[] = []
  const filters: ExportFilter[] = ["all", "selected", "frozen"]
  const sharedKeywords = [
    "channel",
    "channels",
    "telegram",
    "chat",
    "id",
    "copy",
    "clipboard",
  ]

  for (const filter of filters) {
    const filterLabel = FILTER_LABELS[filter]
    const filterSlug = filter
    const isTsv = format === "name-tsv"

    commands.push({
      id: isTsv
        ? `copy-channel-names-and-telegram-chat-ids-${filterSlug}`
        : `copy-channel-telegram-chat-ids-${filterSlug}`,
      kind: "action",
      label: isTsv
        ? `Copy List of ${filterLabel} Channel Names and Telegram Chat IDs`
        : `Copy List of ${filterLabel} Telegram Chat IDs`,
      keywords: [
        ...sharedKeywords,
        ...filterKeywords(filter),
        ...(isTsv ? ["name", "names", "tsv", "tab"] : ["numeric", "number"]),
      ],
      group: "Copy",
      disabled: (ctx) => buildCopyDisabled(filter, ctx),
      run: async (ctx) => {
        const items = await listChannelsWithTelegramChatIdForFilter(filter, ctx)
        if (items.length === 0) {
          emptyTelegramChatIdToast(filter)
          return
        }
        const lines = items
          .map(
            isTsv
              ? channelToNameAndTelegramChatIdTsvLine
              : channelToTelegramChatIdCopyLine,
          )
          .sort((a, b) => a.localeCompare(b))
        const offlineHint = ctx.isOffline
          ? " (from local cache — may not include latest server data)"
          : ""
        const successMessage = isTsv
          ? `Copied ${items.length} channel name${items.length === 1 ? "" : "s"} with Telegram chat IDs${offlineHint}`
          : `Copied ${items.length} Telegram chat ID${items.length === 1 ? "" : "s"}${offlineHint}`
        await copyTextToClipboard(joinCopyLines(lines), successMessage)
      },
    })
  }

  return commands
}

export function buildChannelTelegramChatIdCommands(): CommandDef[] {
  return [
    ...buildTelegramChatIdCopyCommands("ids"),
    ...buildTelegramChatIdCopyCommands("name-tsv"),
    {
      id: "copy-channel-telegram-chat-id",
      kind: "entity-root",
      label: "Copy Channel Telegram Chat ID",
      keywords: [
        "channel",
        "telegram",
        "chat",
        "id",
        "copy",
        "clipboard",
        "single",
        "one",
      ],
      group: "Copy",
      entityFlow: "copy-channel-telegram-chat-id",
      disabled: (ctx) => {
        if (countChannelsWithTelegramChatId(ctx.channels) === 0) {
          return {
            disabled: true,
            reason: "No channels with Telegram chat IDs — sync channels first",
          }
        }
        return { disabled: false }
      },
      run: () => {},
    },
  ]
}

export async function copyChannelTelegramChatId(
  channel: Channel,
): Promise<void> {
  if (channel.telegramChatId == null) {
    toast.info(
      `No Telegram chat ID for @${channel.name} — sync the channel to populate it`,
    )
    return
  }
  await copyTextToClipboard(
    channelToTelegramChatIdCopyLine(channel),
    `Copied Telegram chat ID for @${channel.name}`,
  )
}
