import { toast } from "sonner"

import type { ChannelInfoResponse } from "@/client"
import type { CommandContext } from "@/lib/commands/types"
import type { Channel, ChannelSettingGroup } from "@/types"
import {
  type ChannelInfoDeps,
  channelInfoDeps,
  fetchChannelInfo,
  mergeChannelInfo,
} from "./channel-info"

/** `channel` with what its page shows now; a page that answered clears the Unavailable mark. */
export function refreshedChannel(
  channel: Channel,
  data: ChannelInfoResponse,
  now: number,
): Channel {
  const base = { ...channel, displayName: channel.displayName || channel.name }
  const wasUnavailable = channel.isUnavailableOnWebView === true
  return {
    ...base,
    ...mergeChannelInfo(base, data),
    isUnavailableOnWebView: data.isUnavailableOnWebView
      ? true
      : wasUnavailable
        ? false
        : channel.isUnavailableOnWebView,
    lastUpdated: now,
  }
}

/** The default group a channel moves to once it is reachable again, if it just became so. */
export function groupForReturningChannel(
  before: Channel,
  after: Channel,
  groups: ChannelSettingGroup[],
): ChannelSettingGroup | undefined {
  if (before.isUnavailableOnWebView !== true || after.isUnavailableOnWebView) {
    return undefined
  }
  return groups.find((group) => group.isDefault)
}

function describeRefreshError(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Failed to refresh channel metadata"
}

export async function refreshChannelMetadata(
  channel: Channel,
  ctx: CommandContext,
  deps: ChannelInfoDeps = channelInfoDeps,
): Promise<void> {
  const info = await fetchChannelInfo(
    channel.name,
    ctx.settings,
    "RefreshChannelMetadata",
    describeRefreshError,
    deps,
  )
  if ("error" in info) {
    console.error("Failed to refresh channel metadata:", info.error)
    toast.error(info.message)
    return
  }

  const updated = refreshedChannel(channel, info.data, Date.now())
  await deps.upsertChannel(updated)
  ctx.setChannels((prev) =>
    prev.map((entry) => (entry.id === channel.id ? updated : entry)),
  )

  const defaultGroup = groupForReturningChannel(
    channel,
    updated,
    ctx.settingGroups,
  )
  if (defaultGroup) {
    await deps.bulkAssignSettingGroup({
      channelIds: [channel.id],
      settingGroupId: defaultGroup.id,
    })
    await ctx.loadChannels()
    await ctx.invalidateSettingGroups()
    toast.success(
      `@${channel.name} is available again — moved to default group`,
    )
    return
  }

  toast.success(`Refreshed metadata for @${channel.name}`)
}
