/**
 * What the Setting groups panel decides, with no React in it: the draft a
 * group edits into, and which groups can be deleted.
 */
import type { SettingGroupWriteBody } from "@/api"
import { isReservedSettingGroup } from "@/lib/channels/setting-groups"
import type { ChannelSettingGroup } from "@/types"

export const emptyDraft = (): SettingGroupWriteBody => ({
  name: "",
  regularSyncEnabled: true,
  dynamicSyncEnabled: false,
  autoSyncIntervalMinutes: 60,
  dynamicSyncExpectedPosts: 15,
  autoFollowForwarded: false,
  isFrozen: false,
  isUnavailableOnWebView: false,
  includeInSyncAll: true,
  includeInBulkSync: true,
  allowIndividualSync: true,
  resetSyncEnabled: true,
})

export const draftFromGroup = (
  group: ChannelSettingGroup,
): SettingGroupWriteBody => ({
  name: group.name,
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
})

export type ToggleKey = keyof Pick<
  SettingGroupWriteBody,
  | "regularSyncEnabled"
  | "dynamicSyncEnabled"
  | "autoFollowForwarded"
  | "isFrozen"
  | "isUnavailableOnWebView"
  | "includeInSyncAll"
  | "includeInBulkSync"
  | "allowIndividualSync"
  | "resetSyncEnabled"
>

export const SYNC_TOGGLES: readonly (readonly [ToggleKey, string])[] = [
  ["regularSyncEnabled", "Regular sync"],
  ["dynamicSyncEnabled", "Dynamic sync"],
  ["autoFollowForwarded", "Auto-follow"],
  ["isFrozen", "Frozen"],
  ["isUnavailableOnWebView", "Restricted"],
]

export const PERMISSION_TOGGLES: readonly (readonly [ToggleKey, string])[] = [
  ["includeInSyncAll", "Include in Sync All"],
  ["includeInBulkSync", "Include in bulk sync"],
  ["allowIndividualSync", "Allow individual sync"],
  ["resetSyncEnabled", "Reset & Sync enabled"],
]

/** Reserved groups (the default and the system ones) are never deleted. */
export function isDeletable(
  group: ChannelSettingGroup | undefined,
): group is ChannelSettingGroup {
  return group !== undefined && !isReservedSettingGroup(group)
}

function channelCount(group: ChannelSettingGroup): number {
  return group.channelCount ?? 0
}

/** A group that still holds channels cannot go; the panel says so up front. */
export function mustEmptyBeforeDelete(group: ChannelSettingGroup): boolean {
  return isDeletable(group) && channelCount(group) > 0
}
