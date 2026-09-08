import { getRouteApi } from "@tanstack/react-router"

const workspaceRoute = getRouteApi("/_tg/workspace")

export function useWorkspaceGroupParams() {
  const { channelGroup, settingGroup } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()

  const setChannelGroupFilter = (groupId: string) => {
    navigate({
      search: (prev) => ({
        ...prev,
        channelGroup: groupId || undefined,
      }),
      replace: true,
    })
  }

  const setSelectedSettingGroup = (groupId: string) => {
    navigate({
      search: (prev) => ({
        ...prev,
        settingGroup: groupId || undefined,
      }),
      replace: true,
    })
  }

  return {
    channelGroupFilter: channelGroup ?? "",
    setChannelGroupFilter,
    selectedSettingGroupId: settingGroup ?? "",
    setSelectedSettingGroup,
  }
}
