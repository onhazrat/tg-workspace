import type { ChannelSettingGroup } from "@/types"

const BUILTIN_GROUP_SORT_ORDER: Record<string, number> = {
  default: 0,
  "slow feed": 1,
  "high velocity": 2,
  frozen: 3,
  restricted: 4,
}

export const isSlowFeedReservedGroup = (group: ChannelSettingGroup): boolean =>
  group.id.startsWith("slow-feed-")

export const isHighVelocityReservedGroup = (
  group: ChannelSettingGroup,
): boolean => group.id.startsWith("high-velocity-")

export const isFrozenReservedGroup = (group: ChannelSettingGroup): boolean =>
  group.id.startsWith("frozen-")

export const isRestrictedReservedGroup = (
  group: ChannelSettingGroup,
): boolean => group.id.startsWith("restricted-")

export const isReservedSettingGroup = (group: ChannelSettingGroup): boolean =>
  group.isReserved ??
  (group.isDefault ||
    isSlowFeedReservedGroup(group) ||
    isHighVelocityReservedGroup(group) ||
    isFrozenReservedGroup(group) ||
    isRestrictedReservedGroup(group))

export const sortSettingGroupsForDisplay = (
  groups: ChannelSettingGroup[],
): ChannelSettingGroup[] =>
  [...groups].sort((left, right) => {
    if (left.isDefault !== right.isDefault) {
      return left.isDefault ? -1 : 1
    }
    const leftOrder =
      BUILTIN_GROUP_SORT_ORDER[left.name.toLowerCase()] ??
      Number.MAX_SAFE_INTEGER
    const rightOrder =
      BUILTIN_GROUP_SORT_ORDER[right.name.toLowerCase()] ??
      Number.MAX_SAFE_INTEGER
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    return left.name.localeCompare(right.name)
  })

export const findFrozenReservedGroup = (
  groups: ChannelSettingGroup[],
): ChannelSettingGroup | undefined => groups.find(isFrozenReservedGroup)

/** Pick the panel selection from cache — URL param wins over default group. */
export const resolveInitialSelectedGroupId = (
  groups: ChannelSettingGroup[],
  urlGroupId: string,
  currentId: string | null,
): string | null => {
  if (groups.length === 0) return currentId
  if (currentId && groups.some((group) => group.id === currentId)) {
    return currentId
  }
  if (urlGroupId && groups.some((group) => group.id === urlGroupId)) {
    return urlGroupId
  }
  return (groups.find((group) => group.isDefault) ?? groups[0]).id
}
