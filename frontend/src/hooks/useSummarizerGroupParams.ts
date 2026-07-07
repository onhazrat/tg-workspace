import { getRouteApi } from "@tanstack/react-router"

const summarizerRoute = getRouteApi("/_tg/summarizer")

export function useSummarizerGroupParams() {
  const { channelGroup, settingGroup } = summarizerRoute.useSearch()
  const navigate = summarizerRoute.useNavigate()

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
