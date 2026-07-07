import { useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/api"
import { sortSettingGroupsForDisplay } from "@/lib/channels/setting-groups"
import type { ChannelSettingGroup } from "@/types"

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"

export async function fetchSettingGroups(): Promise<ChannelSettingGroup[]> {
  const rows = await api.listSettingGroups()
  return sortSettingGroupsForDisplay(rows)
}

export function useSettingGroupsQuery() {
  return useQuery({
    queryKey: queryKeys.settingGroups,
    queryFn: fetchSettingGroups,
    staleTime: SUMMARIZER_STALE_TIME,
    refetchOnWindowFocus: true,
  })
}

export function useInvalidateSettingGroups() {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.settingGroups })
}
