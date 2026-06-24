import type { CommandContext, EntityFlowType } from "@/lib/commands/types"
import { upsertChannel } from "@/lib/repository"
import type { Channel } from "@/types"

export { filterChannelsByQuery } from "@/lib/commands/filter-channels"

export function getEntityCandidates(
  flow: EntityFlowType,
  ctx: CommandContext,
): Channel[] {
  switch (flow) {
    case "search-channel":
      return ctx.channels
    case "select-channel":
      return ctx.channels.filter(
        (channel) =>
          !channel.isFrozen && !ctx.selectedChannels.has(channel.name),
      )
    case "deselect-channel":
      return ctx.channels.filter((channel) =>
        ctx.selectedChannels.has(channel.name),
      )
    case "freeze-channel":
      return ctx.channels.filter(
        (channel) => !channel.isFrozen && !channel.isUnavailableOnWebView,
      )
    case "unfreeze-channel":
      return ctx.channels.filter((channel) => channel.isFrozen)
    case "toggle-auto-follow":
      return ctx.channels
    case "sync-channel":
    case "delete-channel":
      return ctx.channels
    case "open-post":
      return []
    default:
      return []
  }
}

export async function runEntityChannelAction(
  flow: EntityFlowType,
  channel: Channel,
  ctx: CommandContext,
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
      await upsertChannel(updated)
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
      await upsertChannel(updated)
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
      await upsertChannel(updated)
      ctx.setChannels((prev) =>
        prev.map((entry) => (entry.id === channel.id ? updated : entry)),
      )
      return
    }
    case "sync-channel": {
      await ctx.handleScrapeChannel(channel, true, "Manual (Palette)", {
        ignoreFrozen: true,
      })
      return
    }
    default:
      return
  }
}

export async function runBulkFreezeSelected(
  ctx: CommandContext,
): Promise<void> {
  const updatedChannels = ctx.channels.map((channel) => {
    if (
      ctx.selectedChannels.has(channel.name) &&
      !channel.isUnavailableOnWebView
    ) {
      return { ...channel, isFrozen: true }
    }
    return channel
  })
  ctx.setChannels(updatedChannels)
  for (const channel of updatedChannels) {
    if (
      ctx.selectedChannels.has(channel.name) &&
      !channel.isUnavailableOnWebView
    ) {
      await upsertChannel(channel)
    }
  }
  ctx.setSelectedChannels(new Set())
}

export async function runBulkUnfreezeSelected(
  ctx: CommandContext,
): Promise<void> {
  const updatedChannels = ctx.channels.map((channel) => {
    if (
      ctx.selectedChannels.has(channel.name) &&
      !channel.isUnavailableOnWebView
    ) {
      return { ...channel, isFrozen: false }
    }
    return channel
  })
  ctx.setChannels(updatedChannels)
  for (const channel of updatedChannels) {
    if (
      ctx.selectedChannels.has(channel.name) &&
      !channel.isUnavailableOnWebView
    ) {
      await upsertChannel(channel)
    }
  }
}
