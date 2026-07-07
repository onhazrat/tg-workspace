import { describe, expect, it } from "bun:test"
import type { ChannelSettingGroup } from "@/types"
import {
  findFrozenReservedGroup,
  isFrozenReservedGroup,
  isHighVelocityReservedGroup,
  isReservedSettingGroup,
  isSlowFeedReservedGroup,
  resolveInitialSelectedGroupId,
  sortSettingGroupsForDisplay,
} from "./setting-groups"

const frozenGroup = (id: string): ChannelSettingGroup => ({
  id,
  name: "Frozen",
  isDefault: false,
  regularSyncEnabled: false,
  dynamicSyncEnabled: false,
  autoSyncIntervalMinutes: 60,
  dynamicSyncExpectedPosts: 15,
  autoFollowForwarded: false,
  isFrozen: true,
  isUnavailableOnWebView: false,
})

describe("setting group helpers", () => {
  it("detects canonical frozen group by id prefix", () => {
    const canonical = frozenGroup("frozen-global")
    const legacy = frozenGroup("legacy-uuid")
    expect(isFrozenReservedGroup(canonical)).toBe(true)
    expect(isFrozenReservedGroup(legacy)).toBe(false)
    expect(isReservedSettingGroup(legacy)).toBe(false)
    expect(isReservedSettingGroup(canonical)).toBe(true)
  })

  it("prefers canonical frozen group when duplicates exist", () => {
    const groups = [
      frozenGroup("legacy-uuid"),
      frozenGroup("frozen-global"),
    ]
    expect(findFrozenReservedGroup(groups)?.id).toBe("frozen-global")
  })

  it("detects builtin preset groups and sorts them", () => {
    const groups = [
      { ...frozenGroup("frozen-global"), name: "Frozen" },
      {
        ...frozenGroup("slow-feed-global"),
        id: "slow-feed-global",
        name: "Slow feed",
        isFrozen: false,
      },
      {
        ...frozenGroup("default-global"),
        id: "default-global",
        name: "default",
        isDefault: true,
        isFrozen: false,
      },
    ]
    expect(isSlowFeedReservedGroup(groups[1]!)).toBe(true)
    expect(isHighVelocityReservedGroup(groups[1]!)).toBe(false)
    expect(sortSettingGroupsForDisplay(groups).map((group) => group.name)).toEqual(
      ["default", "Slow feed", "Frozen"],
    )
  })

  it("prefers URL group id over default when nothing selected", () => {
    const groups = [
      {
        ...frozenGroup("default-global"),
        id: "default-global",
        name: "default",
        isDefault: true,
        isFrozen: false,
      },
      {
        ...frozenGroup("custom-1"),
        id: "custom-1",
        name: "News",
        isFrozen: false,
      },
    ]
    expect(resolveInitialSelectedGroupId(groups, "custom-1", null)).toBe(
      "custom-1",
    )
    expect(resolveInitialSelectedGroupId(groups, "", null)).toBe("default-global")
    expect(resolveInitialSelectedGroupId(groups, "custom-1", "default-global")).toBe(
      "default-global",
    )
  })
})
