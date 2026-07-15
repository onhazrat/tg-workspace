import { toast } from "sonner"

import { api } from "@/api"
import { sortSettingGroupsForDisplay } from "@/lib/channels/setting-groups"
import type { CommandContext, CommandDef } from "@/lib/commands/types"
import type { Channel, ChannelSettingGroup } from "@/types"

export function formatSettingGroupCandidateLabel(
  group: ChannelSettingGroup,
  channels: Channel[],
): string {
  const count =
    group.channelCount ??
    channels.filter((channel) => channel.settingGroupId === group.id).length
  const channelLabel = count === 1 ? "channel" : "channels"
  return `${group.name} (${count} ${channelLabel})`
}

export function getSettingGroupEntityCandidates(
  ctx: CommandContext,
  query: string,
): Array<{ id: string; label: string }> {
  const normalized = query.trim().toLowerCase()
  const groups = sortSettingGroupsForDisplay(ctx.settingGroups)
  const filtered = normalized
    ? groups.filter(
        (group) =>
          group.name.toLowerCase().includes(normalized) ||
          group.id.toLowerCase().includes(normalized),
      )
    : groups
  return filtered.map((group) => ({
    id: group.id,
    label: formatSettingGroupCandidateLabel(group, ctx.channels),
  }))
}

function applyGroupFieldsToChannel(
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

export async function moveSelectedChannelsToSettingGroup(
  ctx: CommandContext,
  settingGroupId: string,
): Promise<void> {
  const group = ctx.settingGroups.find((item) => item.id === settingGroupId)
  if (!group) return

  const channelIds = ctx.channels
    .filter((channel) => ctx.selectedChannels.has(channel.name))
    .map((channel) => channel.id)
  if (channelIds.length === 0) return

  await api.bulkAssignSettingGroup({
    channelIds,
    settingGroupId,
  })

  ctx.setChannels((prev) =>
    prev.map((channel) =>
      channelIds.includes(channel.id)
        ? applyGroupFieldsToChannel(channel, group)
        : channel,
    ),
  )
  await ctx.invalidateSettingGroups()
  toast.success(
    `Moved ${channelIds.length} channel${channelIds.length === 1 ? "" : "s"} to "${group.name}"`,
  )
}

export function buildGroupCommands(): CommandDef[] {
  return [
    {
      id: "filter-channels-by-setting-group",
      kind: "entity-root",
      label: "Filter Channels by Group",
      keywords: ["channel", "group", "filter", "setting", "sync", "preset"],
      group: "Channels",
      entityFlow: "filter-by-setting-group",
      run: (ctx, payload) => {
        const groupId = payload as string
        if (!groupId) return
        ctx.setActiveTab("channels")
        ctx.setChannelGroupFilter(groupId)
      },
    },
    {
      id: "move-selected-channels-to-setting-group",
      kind: "entity-root",
      label: "Move Selected Channels to Group",
      keywords: [
        "channel",
        "group",
        "move",
        "bulk",
        "assign",
        "setting",
        "sync",
      ],
      group: "Channels",
      entityFlow: "move-to-setting-group",
      disabled: (ctx) => {
        if (ctx.isOffline) {
          return { disabled: true, reason: "Server offline" }
        }
        if (ctx.selectedChannels.size === 0) {
          return { disabled: true, reason: "No channels selected" }
        }
        return { disabled: false }
      },
      run: async (ctx, payload) => {
        const groupId = payload as string
        if (!groupId) return
        await moveSelectedChannelsToSettingGroup(ctx, groupId)
      },
    },
    {
      id: "open-setting-group",
      kind: "entity-root",
      label: "Open Setting Group",
      keywords: [
        "setting",
        "group",
        "sync",
        "scraping",
        "preset",
        "edit",
        "configure",
      ],
      group: "Settings",
      entityFlow: "open-setting-group",
      run: (ctx, payload) => {
        const groupId = payload as string
        if (!groupId) return
        ctx.setActiveTab("settings")
        ctx.setActiveSection("sync")
        ctx.setSelectedSettingGroup(groupId)
      },
    },
  ]
}
