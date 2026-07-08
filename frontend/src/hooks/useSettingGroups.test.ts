import { describe, expect, it } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/hooks/queryKeys"
import { sortSettingGroupsForDisplay } from "@/lib/channels/setting-groups"
import type { ChannelSettingGroup } from "@/types"

const mockGroups: ChannelSettingGroup[] = [
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
    channelCount: 1,
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
    channelCount: 0,
  },
]

describe("useSettingGroups query cache", () => {
  it("fetches once and serves cached groups without another API call", async () => {
    let listCallCount = 0
    const queryFn = async () => {
      listCallCount += 1
      return sortSettingGroupsForDisplay(mockGroups)
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    await queryClient.fetchQuery({
      queryKey: queryKeys.settingGroups,
      queryFn,
      staleTime: 60_000,
    })
    expect(listCallCount).toBe(1)

    await queryClient.fetchQuery({
      queryKey: queryKeys.settingGroups,
      queryFn,
      staleTime: 60_000,
    })
    expect(listCallCount).toBe(1)
  })
})
