import { useCallback, useMemo } from "react"
import { api } from "@/api"
import { useCommandPaletteContext } from "@/components/CommandPaletteProvider"
import { useAI } from "@/contexts/AIContext"
import { useChatContext } from "@/contexts/ChatContext"
import { useData } from "@/contexts/DataContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import { useApiStatus } from "@/hooks/useApiStatus"
import { useGuidedTour } from "@/hooks/useGuidedTour"
import { useJobToggles } from "@/hooks/useJobToggles"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { useSettingsSection } from "@/hooks/useSettingsSection"
import { useSummarizerGroupParams } from "@/hooks/useSummarizerGroupParams"
import { buildPostsInScopeCounts } from "@/lib/channels/sort-channels-for-grid"
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
import { useLoadDBStats } from "./useDBStats"
import { useInvalidateSummaries, useSummariesHistory } from "./useSummaries"

export function useCommandRegistry(): {
  commands: CommandDef[]
  context: CommandContext
} {
  const settings = useSettings()
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
  const {
    setActiveTab,
    startDate,
    endDate,
    setDateRange,
    setCurrentSummaryId,
    currentSummaryId,
    historySearchQuery,
    setHistorySearchQuery,
    starredOnly,
    setStarredOnly,
  } = useUI()
  const { setActiveSection } = useSettingsSection()
  const {
    handleScrapeAll,
    handleScrapeSelected,
    handleRecheckRestricted,
    handleScrapeChannel,
    addToSyncQueue,
    autoSyncPauseUntil,
    setAutoSyncPauseUntil,
    postSearch,
    setPostSearch,
    setSemanticSearchQuery,
    setSemanticSearchRespectsTimeRange,
    setSemanticSearchRespectsChannels,
    setRelatedPostSearch,
    handleFilterPosts,
    forwardedFilter,
    setForwardedFilter,
    getScopedPosts,
    semanticSearchQuery,
    mediaFilter,
    setMediaFilter,
    maxPostsPerChannel,
    setMaxPostsPerChannel,
    setMaxPostsPerChannelMode,
    setPostSortOrder,
  } = useScraper()
  const {
    setSummary,
    handleSummarize,
    copySummaryPrompt,
    completePendingSummary,
  } = useAI()
  const { setChatMessages } = useChatContext()
  const { getEffectiveGlobalStartTime } = useSettings()
  const { isOffline } = useApiStatus()
  const { startTour } = useGuidedTour()
  const jobToggles = useJobToggles()
  const palette = useCommandPaletteContext()
  const { setChannelGroupFilter, setSelectedSettingGroup } =
    useSummarizerGroupParams()
  const { data: settingGroups = [] } = useSettingGroupsQuery()
  const invalidateSettingGroups = useInvalidateSettingGroups()

  // Per-channel in-scope counts on demand. Mirrors ChannelGrid: server-side
  // when no semantic search is active and a selection exists, else derived
  // from the scoped posts (semantic results can't be counted server-side).
  const getPostsInScopeCounts = useCallback(async (): Promise<
    Record<string, number>
  > => {
    const serverEligible =
      !semanticSearchQuery.trim() && selectedChannels.size > 0
    if (serverEligible) {
      const selectedChannelNames = channels
        .filter((channel) => selectedChannels.has(channel.name))
        .map((channel) => channel.name)
      return api.getPostsCounts({
        channelNames: selectedChannelNames,
        startDate,
        endDate,
        keyword: postSearch,
        forwarded: forwardedFilter,
        media: mediaFilter,
        maxPerChannel: maxPostsPerChannel,
      })
    }
    return buildPostsInScopeCounts(await getScopedPosts())
  }, [
    semanticSearchQuery,
    selectedChannels,
    channels,
    startDate,
    endDate,
    postSearch,
    forwardedFilter,
    mediaFilter,
    maxPostsPerChannel,
    getScopedPosts,
  ])

  const context = useMemo<CommandContext>(
    () => ({
      setActiveTab,
      setActiveSection,
      channels,
      channelStats,
      selectedChannels,
      setSelectedChannels,
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
      postSearch,
      setPostSearch,
      setSemanticSearchQuery,
      setSemanticSearchRespectsTimeRange,
      setSemanticSearchRespectsChannels,
      setRelatedPostSearch,
      handleFilterPosts,
      historySearchQuery,
      setHistorySearchQuery,
      setSummary,
      setDateRange,
      setChatMessages,
      setCurrentSummaryId,
      currentSummaryId,
      settings: {
        theme: settings.theme,
        setTheme: settings.setTheme,
        aiLanguage: settings.aiLanguage,
        setAiLanguage: settings.setAiLanguage,
        selectedModel: settings.selectedModel,
        setSelectedModel: settings.setSelectedModel,
        regularSyncIntervalMinutes: settings.regularSyncIntervalMinutes,
        setRegularSyncIntervalMinutes: settings.setRegularSyncIntervalMinutes,
        dynamicSyncEnabledDefault: settings.dynamicSyncEnabledDefault,
        setDynamicSyncEnabledDefault: settings.setDynamicSyncEnabledDefault,
        dynamicSyncExpectedPostsDefault:
          settings.dynamicSyncExpectedPostsDefault,
        setDynamicSyncExpectedPostsDefault:
          settings.setDynamicSyncExpectedPostsDefault,
        syncFailureBackoffMinutes: settings.syncFailureBackoffMinutes,
        setSyncFailureBackoffMinutes: settings.setSyncFailureBackoffMinutes,
        aiTemperature: settings.aiTemperature,
        setAiTemperature: settings.setAiTemperature,
        proxyEnabled: settings.proxyEnabled,
        setProxyEnabled: settings.setProxyEnabled,
        defaultProxyUrls: settings.defaultProxyUrls,
        setDefaultProxyUrls: settings.setDefaultProxyUrls,
        proxyDefaultConcurrency: settings.proxyDefaultConcurrency,
        setProxyDefaultConcurrency: settings.setProxyDefaultConcurrency,
        proxyConcurrencyOverrides: settings.proxyConcurrencyOverrides,
        setProxyConcurrencyOverrides: settings.setProxyConcurrencyOverrides,
        torEnabled: settings.torEnabled,
        setTorEnabled: settings.setTorEnabled,
        torMode: settings.torMode,
        setTorMode: settings.setTorMode,
        torProxyUrls: settings.torProxyUrls,
        setTorProxyUrls: settings.setTorProxyUrls,
        torRotationStrategy: settings.torRotationStrategy,
        setTorRotationStrategy: settings.setTorRotationStrategy,
        torControlEnabled: settings.torControlEnabled,
        setTorControlEnabled: settings.setTorControlEnabled,
        torControlPort: settings.torControlPort,
        setTorControlPort: settings.setTorControlPort,
        torAutoRotate: settings.torAutoRotate,
        setTorAutoRotate: settings.setTorAutoRotate,
        torRotationThreshold: settings.torRotationThreshold,
        setTorRotationThreshold: settings.setTorRotationThreshold,
        syncConcurrency: settings.syncConcurrency,
        setSyncConcurrency: settings.setSyncConcurrency,
        embeddingsEnabled: settings.embeddingsEnabled,
        setEmbeddingsEnabled: settings.setEmbeddingsEnabled,
        embeddingsPaused: settings.embeddingsPaused,
        setEmbeddingsPaused: settings.setEmbeddingsPaused,
        translationEnabled: settings.translationEnabled,
        setTranslationEnabled: settings.setTranslationEnabled,
        autoTranslate: settings.autoTranslate,
        setAutoTranslate: settings.setAutoTranslate,
        translationModel: settings.translationModel,
        setTranslationModel: settings.setTranslationModel,
        translationTargetLanguage: settings.translationTargetLanguage,
        setTranslationTargetLanguage: settings.setTranslationTargetLanguage,
        postRetentionDays: settings.postRetentionDays,
        setPostRetentionDays: settings.setPostRetentionDays,
        logRetentionDays: settings.logRetentionDays,
        setLogRetentionDays: settings.setLogRetentionDays,
        globalStartTimeMode: settings.globalStartTimeMode,
        setGlobalStartTimeMode: settings.setGlobalStartTimeMode,
        globalStartTimeValue: settings.globalStartTimeValue,
        setGlobalStartTimeValue: settings.setGlobalStartTimeValue,
        showChannelBio: settings.showChannelBio,
        setShowChannelBio: settings.setShowChannelBio,
        showChannelSubscribers: settings.showChannelSubscribers,
        setShowChannelSubscribers: settings.setShowChannelSubscribers,
        showChannelTelegramChatId: settings.showChannelTelegramChatId,
        setShowChannelTelegramChatId: settings.setShowChannelTelegramChatId,
        showChannelPhotos: settings.showChannelPhotos,
        setShowChannelPhotos: settings.setShowChannelPhotos,
        showChannelVideos: settings.showChannelVideos,
        setShowChannelVideos: settings.setShowChannelVideos,
        showChannelFiles: settings.showChannelFiles,
        setShowChannelFiles: settings.setShowChannelFiles,
        showChannelLinks: settings.showChannelLinks,
        setShowChannelLinks: settings.setShowChannelLinks,
        showChannelStartId: settings.showChannelStartId,
        setShowChannelStartId: settings.setShowChannelStartId,
      },
      forwardedFilter,
      setForwardedFilter,
      mediaFilter,
      setMediaFilter,
      setMaxPostsPerChannel,
      setMaxPostsPerChannelMode,
      setPostSortOrder,
      getScopedPosts,
      getPostsInScopeCounts,
      starredOnly,
      setStarredOnly,
      handleSummarize,
      copySummaryPrompt,
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
      copySummaryPrompt,
      currentSummaryId,
      endDate,
      getScopedPosts,
      getPostsInScopeCounts,
      forwardedFilter,
      getEffectiveGlobalStartTime,
      handleFilterPosts,
      handleSummarize,
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
      mediaFilter,
      palette,
      postSearch,
      selectedChannels,
      setActiveSection,
      setActiveTab,
      setAutoSyncPauseUntil,
      setChannels,
      setChatMessages,
      setCurrentSummaryId,
      setDateRange,
      setForwardedFilter,
      setMaxPostsPerChannel,
      setMaxPostsPerChannelMode,
      setPostSortOrder,
      setHistorySearchQuery,
      setPostSearch,
      setRelatedPostSearch,
      setSelectedChannels,
      setSemanticSearchQuery,
      setSemanticSearchRespectsChannels,
      setSemanticSearchRespectsTimeRange,
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
      ...buildNavigateCommands(),
      ...buildActionCommands(),
      ...buildSettingCommands(),
      ...buildGroupCommands(),
      ...buildChannelEntityCommands(),
      ...buildChannelOpsCommands(),
      ...buildDataTransferCommands(),
      ...buildChannelTelegramChatIdCommands(),
      ...buildExtendedCommands(),
    ]
    return all.filter((command) => !command.when || command.when(context))
  }, [context])

  return { commands, context }
}
