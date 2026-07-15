import { describe, expect, it } from "bun:test"

import { resolveInitialSelectedGroupId } from "@/lib/channels/setting-groups"
import type { ChannelSettingGroup } from "@/types"

const groups: ChannelSettingGroup[] = [
  {
    id: "default-global",
    name: "default",
    isDefault: true,
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
    channelCount: 2,
  },
  {
    id: "custom-1",
    name: "News",
    isDefault: false,
    regularSyncEnabled: true,
    dynamicSyncEnabled: false,
    autoSyncIntervalMinutes: 120,
    dynamicSyncExpectedPosts: 5,
    autoFollowForwarded: false,
    isFrozen: false,
    isUnavailableOnWebView: false,
    includeInSyncAll: true,
    includeInBulkSync: true,
    allowIndividualSync: true,
    resetSyncEnabled: true,
    channelCount: 0,
  },
]

describe("SettingGroupsPanel selection behavior", () => {
  it("resolves group clicks from cached data without refetching", () => {
    const firstSelection = resolveInitialSelectedGroupId(groups, "", null)
    expect(firstSelection).toBe("default-global")

    const clickedGroup = groups.find((group) => group.id === "custom-1")
    expect(clickedGroup).toBeDefined()

    const nextSelection = resolveInitialSelectedGroupId(
      groups,
      "custom-1",
      clickedGroup!.id,
    )
    expect(nextSelection).toBe("custom-1")
  })
})
