import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { api } from "@/api"
import { emptyDraft } from "@/components/setting-groups/setting-groups-model"
import { errorText } from "@/lib/artifacts/artifact-run"
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

/** Create a group with the panel's defaults; resolves whether it was created. */
export function useCreateSettingGroup() {
  const invalidate = useInvalidateSettingGroups()
  return async (name: string): Promise<boolean> => {
    try {
      const created = await api.createSettingGroup({ ...emptyDraft(), name })
      toast.success(`Created group "${created.name}"`)
      await invalidate()
      return true
    } catch (error) {
      toast.error(errorText(error, "Failed to create setting group"))
      return false
    }
  }
}
