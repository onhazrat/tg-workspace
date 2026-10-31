import { useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useCallback, useMemo } from "react"
import { useCommandPaletteContext } from "@/components/CommandPaletteProvider"
import { useRunGated } from "@/components/complete-window/Gate"
import { useSettingsRegistry } from "@/components/settings-page/registry"
import { useAI } from "@/contexts/AIContext"
import { useChatContext } from "@/contexts/ChatContext"
import { useData } from "@/contexts/DataContext"
import {
  usePostsViewEdits,
  usePostsViewState,
} from "@/contexts/PostsViewContext"
import { useScope } from "@/contexts/ScopeContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useSync } from "@/contexts/SyncContext"
import { useUI } from "@/contexts/UIContext"
import { useApiStatus } from "@/hooks/useApiStatus"
import { useGuidedTour } from "@/hooks/useGuidedTour"
import { useHistoryParams } from "@/hooks/useHistoryParams"
import { useJobToggles } from "@/hooks/useJobToggles"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { useWorkspaceGroupParams } from "@/hooks/useWorkspaceGroupParams"
import { selectedScopeCounts } from "@/lib/artifacts/artifact-run"
import {
  addFunnel,
  emptyFilter,
  filterNames,
  printChannelFilter,
} from "@/lib/channels/channel-filter"
import { useShownChannels } from "@/lib/channels/shown-channels"
import {
  buildActionCommands,
  buildChannelEntityCommands,
  buildChannelOpsCommands,
  buildChannelTelegramChatIdCommands,
  buildDataTransferCommands,
  buildExtendedCommands,
  buildGroupCommands,
  buildNavigateCommands,
  buildSettingCommands,
} from "@/lib/commands"
import type { CommandContext, CommandDef } from "@/lib/commands/types"
import { SERVER_TABLE_NAMES } from "@/lib/data-transfer/tables"
import { historyPaletteBinding } from "@/lib/history/history-params"
import { useLoadDBStats } from "./useDBStats"
import { useInvalidateSummaries, useSummariesHistory } from "./useSummaries"

const workspaceRoute = getRouteApi("/_tg/")

export function useCommandRegistry(): {
  commands: CommandDef[]
  context: CommandContext
} {
  const settings = useSettings()
  const palette = useCommandPaletteContext()
  const navigateWorkspace = workspaceRoute.useNavigate()
  const {
    channels,
    channelStats,
    selectedChannels,
    setSelectedChannels,
    setChannels,
    loadChannels,
  } = useData()
  // Sourced from their own hooks rather than `DataContext`; the
  // `CommandContext` contract these feed is unchanged.
  const summariesHistory = useSummariesHistory()
  const loadHistory = useInvalidateSummaries()
  const loadDBStats = useLoadDBStats()
  const { startDate, endDate, setFixedRange: setDateRange } = useScope()
  const { setActiveTab, workspaceTabs, currentSummaryId } = useUI()
  // History's search and Starred live in the URL, as the bar's do.
  const history = useHistoryParams()
  const {
    historySearchQuery,
    setHistorySearchQuery,
    starredOnly,
    setStarredOnly,
  } = useMemo(
    () => historyPaletteBinding(history.params, history.setParams),
    [history.params, history.setParams],
  )
  // The Settings commands come from the registry, read while the palette is
  // open (SET-02).
  const settingsRegistry = useSettingsRegistry({ enabled: palette.open })
  const openSetting = useCallback(
    (id: string) => {
      navigateWorkspace({
        search: (previous) => ({
          ...previous,
          tab: "settings" as const,
          section: undefined,
          setting: id,
        }),
      })
    },
    [navigateWorkspace],
  )
  const {
    handleScrapeAll,
    handleScrapeSelected,
    handleRecheckRestricted,
    handleScrapeChannel,
    addToSyncQueue,
    autoSyncPauseUntil,
    setAutoSyncPauseUntil,
  } = useSync()
  const { view: postsView } = usePostsViewState()
  const postsEdits = usePostsViewEdits()
  const { setSummary, completePendingSummary } = useAI()
  const runGated = useRunGated()
  const { setChatMessages } = useChatContext()
  const { getEffectiveGlobalStartTime } = useSettings()
  const { isOffline } = useApiStatus()
  const { startTour } = useGuidedTour()
  const jobToggles = useJobToggles()
  const { setChannelFilterText, setSelectedSettingGroup } =
    useWorkspaceGroupParams()
  const { data: settingGroups = [] } = useSettingGroupsQuery()
  const shownChannelNames = useShownChannels()
  // The palette's "filter by Setting group" sets a one-Condition filter.
  const setChannelGroupFilter = (groupId: string) =>
    setChannelFilterText(
      printChannelFilter(
        addFunnel(emptyFilter(), "group", groupId),
        filterNames(settingGroups),
      ),
    )
  const invalidateSettingGroups = useInvalidateSettingGroups()
  // Per-channel in-scope counts on demand, as ChannelGrid shows them: the
  // selected Posts in the window, which a meaning search does not change
  // (PTR-05). Through the Scope counts' cache entry, fetched fresh so Trim
  // selection never acts on stale counts.
  const queryClient = useQueryClient()
  const getPostsInScopeCounts = useCallback(async (): Promise<
    Record<string, number>
  > => {
    if (selectedChannels.size === 0) return {}
    return selectedScopeCounts(queryClient, postsView)
  }, [selectedChannels, postsView, queryClient])

  const context = useMemo<CommandContext>(
    () => ({
      setActiveTab,
      openSetting,
      channels,
      channelStats,
      selectedChannels,
      setSelectedChannels,
      shownChannelNames,
      setChannels,
      handleScrapeAll,
      handleScrapeSelected,
      handleRecheckRestricted,
      handleScrapeChannel,
      addToSyncQueue,
      loadChannels,
      loadDBStats,
      getEffectiveGlobalStartTime,
      isOffline,
      autoSyncPauseUntil,
      setAutoSyncPauseUntil,
      startTour,
      jobToggles,
      palette,
      summariesHistory,
      postDateRange: { startDate, endDate },
      postsView,
      postsEdits,
      historySearchQuery,
      setHistorySearchQuery,
      setSummary,
      setDateRange,
      setChatMessages,
      workspaceTabs,
      currentSummaryId,
      settings,
      getPostsInScopeCounts,
      starredOnly,
      setStarredOnly,
      // Through the gate on the Action tab, as its buttons are (CW-02).
      handleSummarize: async () => runGated("summary"),
      copySummaryPrompt: async () => runGated("summary-prompt"),
      completePendingSummary,
      loadHistory,
      databaseTables: [...SERVER_TABLE_NAMES],
      settingGroups,
      invalidateSettingGroups,
      setChannelGroupFilter,
      setSelectedSettingGroup,
    }),
    [
      addToSyncQueue,
      autoSyncPauseUntil,
      channelStats,
      channels,
      completePendingSummary,
      currentSummaryId,
      endDate,
      getPostsInScopeCounts,
      getEffectiveGlobalStartTime,
      handleScrapeAll,
      handleScrapeChannel,
      handleScrapeSelected,
      handleRecheckRestricted,
      historySearchQuery,
      isOffline,
      jobToggles,
      loadChannels,
      loadDBStats,
      loadHistory,
      palette,
      postsView,
      postsEdits,
      runGated,
      selectedChannels,
      openSetting,
      setActiveTab,
      setAutoSyncPauseUntil,
      setChannels,
      setChatMessages,
      workspaceTabs,
      setDateRange,
      setHistorySearchQuery,
      setSelectedChannels,
      shownChannelNames,
      setStarredOnly,
      setSummary,
      settings,
      settingGroups,
      invalidateSettingGroups,
      setChannelGroupFilter,
      setSelectedSettingGroup,
      startDate,
      startTour,
      starredOnly,
      summariesHistory,
    ],
  )

  const commands = useMemo(() => {
    const all = [
      ...buildNavigateCommands(settingsRegistry.permissions),
      ...buildActionCommands(),
      ...buildSettingCommands(settingsRegistry),
      ...buildGroupCommands(),
      ...buildChannelEntityCommands(),
      ...buildChannelOpsCommands(),
      ...buildDataTransferCommands(),
      ...buildChannelTelegramChatIdCommands(),
      ...buildExtendedCommands(),
    ]
    return all.filter((command) => !command.when || command.when(context))
  }, [context, settingsRegistry])

  return { commands, context }
}
