import { api } from "@/api"
import type { CommandContext } from "@/lib/commands/types"
import type { Channel, ChannelSettingGroup } from "@/types"

/**
 * A channel as the server leaves it after a move into `group`: the group's
 * sync policy is copied onto the channel row, so the grid shows the new flags
 * without waiting for a reload. One copy for the grid and the command palette,
 * because a field missing from either leaves that surface showing the old
 * group's policy until the next refetch.
 */
export function applyGroupFieldsToChannel(
  channel: Channel,
  group: ChannelSettingGroup,
): Channel {
  return {
    ...channel,
    settingGroupId: group.id,
    settingGroupName: group.name,
    regularSyncEnabled: group.regularSyncEnabled,
    dynamicSyncEnabled: group.dynamicSyncEnabled,
    autoSyncIntervalMinutes: group.autoSyncIntervalMinutes,
    dynamicSyncExpectedPosts: group.dynamicSyncExpectedPosts,
    autoFollowForwarded: group.autoFollowForwarded,
    isFrozen: group.isFrozen,
    isUnavailableOnWebView: group.isUnavailableOnWebView,
    includeInSyncAll: group.includeInSyncAll,
    includeInBulkSync: group.includeInBulkSync,
    allowIndividualSync: group.allowIndividualSync,
    resetSyncEnabled: group.resetSyncEnabled,
  }
}

export interface AssignSettingGroupContext
  extends Pick<
    CommandContext,
    "settingGroups" | "setChannels" | "loadChannels" | "invalidateSettingGroups"
  > {}

/**
 * Move channels into a setting group, the Channels tab's bulk move and freeze.
 *
 * A group this browser has not loaded yet (created in another tab, say) is
 * still assigned; the channel list is then reloaded, because there is no
 * policy here to copy onto the rows.
 */
export async function assignChannelsToSettingGroup(
  channelIds: string[],
  settingGroupId: string,
  ctx: AssignSettingGroupContext,
  assign: typeof api.bulkAssignSettingGroup = api.bulkAssignSettingGroup,
): Promise<void> {
  if (!settingGroupId || channelIds.length === 0) return
  await assign({ channelIds, settingGroupId })
  const group = ctx.settingGroups.find((item) => item.id === settingGroupId)
  if (!group) {
    await ctx.loadChannels()
    return
  }
  ctx.setChannels((prev) =>
    prev.map((channel) =>
      channelIds.includes(channel.id)
        ? applyGroupFieldsToChannel(channel, group)
        : channel,
    ),
  )
  await ctx.invalidateSettingGroups()
}
