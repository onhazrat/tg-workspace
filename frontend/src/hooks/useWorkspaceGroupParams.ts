import { getRouteApi } from "@tanstack/react-router"

const workspaceRoute = getRouteApi("/_tg/workspace")

export function useWorkspaceGroupParams() {
  const { channelFilter, settingGroup } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()

  /** The Channel filter's text form; blank removes it from the URL. */
  const setChannelFilterText = (text: string) => {
    navigate({
      search: (prev) => ({
        ...prev,
        channelFilter: text || undefined,
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
    channelFilterText: channelFilter ?? "",
    setChannelFilterText,
    selectedSettingGroupId: settingGroup ?? "",
    setSelectedSettingGroup,
  }
}
