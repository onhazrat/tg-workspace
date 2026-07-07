import { describe, expect, it } from "bun:test"
import type { ChannelSettingGroup } from "@/types"
import {
  findFrozenReservedGroup,
  isFrozenReservedGroup,
  isReservedSettingGroup,
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
})
