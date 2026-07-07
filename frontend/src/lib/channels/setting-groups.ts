import type { ChannelSettingGroup } from "@/types"

export const isFrozenReservedGroup = (group: ChannelSettingGroup): boolean =>
  group.id.startsWith("frozen-")

export const isRestrictedReservedGroup = (group: ChannelSettingGroup): boolean =>
  group.id.startsWith("restricted-")

export const isReservedSettingGroup = (group: ChannelSettingGroup): boolean =>
  group.isDefault ||
  isFrozenReservedGroup(group) ||
  isRestrictedReservedGroup(group)

export const findFrozenReservedGroup = (
  groups: ChannelSettingGroup[],
): ChannelSettingGroup | undefined =>
  groups.find(isFrozenReservedGroup)
