import { describe, expect, it } from "bun:test"
import type { ChannelSettingGroup } from "@/types"

describe("channel setting groups types", () => {
  it("accepts default group shape from API", () => {
    const group: ChannelSettingGroup = {
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
      channelCount: 3,
    }
    expect(group.isDefault).toBe(true)
    expect(group.channelCount).toBe(3)
  })
})
