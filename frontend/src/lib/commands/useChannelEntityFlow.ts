import { getTagNames } from "@/lib/channels/channel-tag-model"
import { type ChannelsApi, upsertChannel } from "@/lib/channels/store"
import { filterPartialHistoryChannels } from "@/lib/commands/filter-channels"
import type { CommandContext, EntityFlowType } from "@/lib/commands/types"
import { filterChannelsWithTelegramChatId } from "@/lib/data-transfer/entities/channel"
import type { Channel } from "@/types"

export { filterChannelsByQuery } from "@/lib/commands/filter-channels"

const allChannels = (ctx: CommandContext) => ctx.channels

/**
 * The channels each entity flow offers to pick from. A flow with no entry here
 * picks something other than a channel (a summary, a post, a table), so it
 * offers no channels.
 */
const ENTITY_CANDIDATES: Partial<
  Record<EntityFlowType, (ctx: CommandContext) => Channel[]>
> = {
  "search-channel": allChannels,
  "select-channel": (ctx) =>
    ctx.channels.filter((channel) => !ctx.selectedChannels.has(channel.name)),
  "deselect-channel": (ctx) =>
    ctx.channels.filter((channel) => ctx.selectedChannels.has(channel.name)),
  "freeze-channel": (ctx) =>
    ctx.channels.filter(
      (channel) => !channel.isFrozen && !channel.isUnavailableOnWebView,
    ),
  "unfreeze-channel": (ctx) =>
    ctx.channels.filter((channel) => channel.isFrozen),
  "toggle-auto-follow": allChannels,
  "fix-partial-history-channel": (ctx) =>
    filterPartialHistoryChannels(ctx.channels),
  "sync-channel": allChannels,
  "delete-channel": allChannels,
  "reset-sync-channel": allChannels,
  "add-tag-channel": allChannels,
  "edit-start-id-channel": allChannels,
  "refresh-metadata-channel": allChannels,
  "copy-channel-telegram-chat-id": (ctx) =>
    filterChannelsWithTelegramChatId(ctx.channels),
  "remove-tag-channel": (ctx) =>
    ctx.channels.filter((channel) => getTagNames(channel.tags).length > 0),
}

export function getEntityCandidates(
  flow: EntityFlowType,
  ctx: CommandContext,
): Channel[] {
  return ENTITY_CANDIDATES[flow]?.(ctx) ?? []
}

export async function runEntityChannelAction(
  flow: EntityFlowType,
  channel: Channel,
  ctx: CommandContext,
  // Test seam, as in `lib/channels/store.ts`; production callers never pass it.
  channelsApi?: ChannelsApi,
): Promise<void> {
  switch (flow) {
    case "search-channel":
      ctx.setActiveTab("channels")
      requestAnimationFrame(() => {
        const card = document.querySelector(
          `[data-channel-name="${channel.name}"]`,
        )
        card?.scrollIntoView({ behavior: "smooth", block: "center" })
      })
      return
    case "select-channel":
      ctx.setSelectedChannels((prev) => new Set([...prev, channel.name]))
      return
    case "deselect-channel":
      ctx.setSelectedChannels((prev) => {
        const next = new Set(prev)
        next.delete(channel.name)
        return next
      })
      return
    case "freeze-channel": {
      const updated = { ...channel, isFrozen: true }
      await upsertChannel(updated, channelsApi)
      ctx.setChannels((prev) =>
        prev.map((entry) => (entry.id === channel.id ? updated : entry)),
      )
      ctx.setSelectedChannels((prev) => {
        const next = new Set(prev)
        next.delete(channel.name)
        return next
      })
      return
    }
    case "unfreeze-channel": {
      const updated = { ...channel, isFrozen: false }
      await upsertChannel(updated, channelsApi)
      ctx.setChannels((prev) =>
        prev.map((entry) => (entry.id === channel.id ? updated : entry)),
      )
      return
    }
    case "toggle-auto-follow": {
      const updated = {
        ...channel,
        autoFollowForwarded: !channel.autoFollowForwarded,
      }
      await upsertChannel(updated, channelsApi)
      ctx.setChannels((prev) =>
        prev.map((entry) => (entry.id === channel.id ? updated : entry)),
      )
      return
    }
    case "sync-channel": {
      await ctx.handleScrapeChannel(channel, true, "Manual (Palette)")
      return
    }
    default:
      return
  }
}

/**
 * Save every selected channel with `isFrozen` set. A channel the web view
 * cannot reach is left alone: its frozen state is not the user's to toggle.
 */
async function saveSelectedFrozen(
  ctx: CommandContext,
  isFrozen: boolean,
  channelsApi?: ChannelsApi,
): Promise<void> {
  const affected = (channel: Channel) =>
    ctx.selectedChannels.has(channel.name) && !channel.isUnavailableOnWebView
  const updatedChannels = ctx.channels.map((channel) =>
    affected(channel) ? { ...channel, isFrozen } : channel,
  )
  ctx.setChannels(updatedChannels)
  for (const channel of updatedChannels.filter(affected)) {
    await upsertChannel(channel, channelsApi)
  }
}

/** Freezing also clears the selection; the frozen channels are skipped by sync. */
export async function runBulkFreezeSelected(
  ctx: CommandContext,
  channelsApi?: ChannelsApi,
): Promise<void> {
  await saveSelectedFrozen(ctx, true, channelsApi)
  ctx.setSelectedChannels(new Set())
}

export async function runBulkUnfreezeSelected(
  ctx: CommandContext,
  channelsApi?: ChannelsApi,
): Promise<void> {
  await saveSelectedFrozen(ctx, false, channelsApi)
}
