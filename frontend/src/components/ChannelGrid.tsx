import { motion } from "motion/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ChannelBulkActions } from "@/components/channel-grid/ChannelBulkActions"
import { ChannelGridBody } from "@/components/channel-grid/ChannelGridBody"
import { ChannelGridDialogs } from "@/components/channel-grid/ChannelGridDialogs"
import { ChannelGridFilterBar } from "@/components/channel-grid/ChannelGridFilterBar"
import { ChannelGridToolbar } from "@/components/channel-grid/ChannelGridToolbar"
import { ChannelGroupChips } from "@/components/channel-grid/ChannelGroupChips"
import { ChannelTagChips } from "@/components/channel-grid/ChannelTagChips"
import { useChannelGridActions } from "@/components/channel-grid/useChannelGridActions"
import { useChannelGridSortState } from "@/components/channel-grid/useChannelGridSortState"
import { useScopedPostCounts } from "@/hooks/usePostsView"
import { useSummarizerGroupParams } from "@/hooks/useSummarizerGroupParams"
import {
  areAllNamesSelected,
  collectGridTags,
  getChannelNamesInGroup,
  getChannelNamesWithTag,
  toggleNamesInSelection,
} from "@/lib/channels/channel-grid-chips"
import {
  buildChannelPseudoTagChips,
  filterTagsBySearch,
  findChannelPseudoTag,
} from "@/lib/channels/channel-tags"
import {
  collectChannelLanguages,
  filterChannelsForGrid,
} from "@/lib/channels/filter-channels-for-grid"
import { buildSelectedTrimRanks } from "@/lib/channels/selected-trim-ranks"
import { sortChannelsForGrid } from "@/lib/channels/sort-channels-for-grid"
import { applyTrimChannelSelection } from "@/lib/channels/trim-selected-channels"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { useApiStatus } from "../hooks/useApiStatus"

type ChannelGridProps = {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

export const ChannelGrid: React.FC<ChannelGridProps> = ({
  scrollContainerRef,
}) => {
  const {
    channels,
    isInitialChannelsLoading,
    channelStats,
    selectedChannels,
    setSelectedChannels,
  } = useData()

  const {
    summarizing,
    includeChannelBioInPrompt,
    setIncludeChannelBioInPrompt,
    includeChannelTagsInPrompt,
    setIncludeChannelTagsInPrompt,
  } = useUI()

  const {
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    trimCount,
    setTrimCount,
    showSortRank,
    setShowSortRank,
  } = useChannelGridSortState()

  const { showChannelSubscribers } = useSettings()

  const { isOffline } = useApiStatus()

  const { scrapingChannels, handleScrapeSelected, handleScrapeAll } =
    useScraper()

  const [channelSearch, setChannelSearch] = useState("")
  const [tagSearch, setTagSearch] = useState("")
  const [selectedLanguageFilter, setSelectedLanguageFilter] =
    useState<string>("")
  const { channelGroupFilter, setChannelGroupFilter } =
    useSummarizerGroupParams()
  const selectedGroupFilter = channelGroupFilter

  const actions = useChannelGridActions()
  const { sortedSettingGroups } = actions

  const filteredChannels = useMemo(
    () =>
      filterChannelsForGrid(channels, {
        groupFilter: selectedGroupFilter,
        languageFilter: selectedLanguageFilter,
        search: channelSearch,
      }),
    [channels, channelSearch, selectedLanguageFilter, selectedGroupFilter],
  )

  // Per-channel in-scope counts (SQL GROUP BY, client fallback for semantic).
  const postsInScopeCounts = useScopedPostCounts()

  const sortedFilteredChannels = useMemo(
    () =>
      sortChannelsForGrid({
        channels: filteredChannels,
        channelStats,
        postsInScopeCounts,
        selectedChannels,
        sortBy,
        sortDirection,
      }),
    [
      channelStats,
      filteredChannels,
      postsInScopeCounts,
      selectedChannels,
      sortBy,
      sortDirection,
    ],
  )

  const selectedTrimRanks = useMemo(
    () =>
      buildSelectedTrimRanks({
        channels,
        channelStats,
        postsInScopeCounts,
        selectedChannels,
        sortBy,
        sortDirection,
      }),
    [
      channelStats,
      channels,
      postsInScopeCounts,
      selectedChannels,
      sortBy,
      sortDirection,
    ],
  )

  const parsedTrimCount = Number.parseInt(trimCount, 10)
  const isTrimCountValid =
    Number.isFinite(parsedTrimCount) && parsedTrimCount >= 1
  const isTrimDisabled =
    selectedChannels.size === 0 ||
    !isTrimCountValid ||
    summarizing ||
    scrapingChannels.size > 0

  const handleTrimSelection = useCallback(() => {
    if (isTrimDisabled) return
    applyTrimChannelSelection({
      channels,
      channelStats,
      postsInScopeCounts,
      selectedChannels,
      sortBy,
      sortDirection,
      count: parsedTrimCount,
      setSelectedChannels,
    })
  }, [
    channelStats,
    channels,
    isTrimDisabled,
    parsedTrimCount,
    postsInScopeCounts,
    selectedChannels,
    setSelectedChannels,
    sortBy,
    sortDirection,
  ])

  const [visibleChannels, setVisibleChannels] = useState(20)

  const hasMoreChannels = visibleChannels < filteredChannels.length

  const loadMoreChannels = useCallback(() => {
    setVisibleChannels((prev) => Math.min(prev + 20, filteredChannels.length))
  }, [filteredChannels.length])

  useEffect(() => {
    setVisibleChannels(20)
  }, [
    channelSearch,
    selectedLanguageFilter,
    selectedGroupFilter,
    sortBy,
    sortDirection,
  ])

  const allTags = useMemo(
    () => collectGridTags(channels, selectedChannels),
    [channels, selectedChannels],
  )

  const visibleTags = useMemo(
    () => filterTagsBySearch(allTags, tagSearch),
    [allTags, tagSearch],
  )

  const pseudoTagChips = useMemo(
    () => buildChannelPseudoTagChips(channels, tagSearch),
    [channels, tagSearch],
  )

  const allLanguages = useMemo(
    () => collectChannelLanguages(channels),
    [channels],
  )

  const handleSelectAll = () => {
    setSelectedChannels(new Set(filteredChannels.map((c) => c.name)))
  }

  const handleUnselectAll = () => {
    setSelectedChannels(new Set())
  }

  const handleRevertSelection = () => {
    setSelectedChannels((prev) => {
      const next = new Set(prev)
      for (const channel of filteredChannels) {
        if (next.has(channel.name)) {
          next.delete(channel.name)
        } else {
          next.add(channel.name)
        }
      }
      return next
    })
  }

  const toggleGroupSelection = (groupId: string) => {
    const channelsInGroup = getChannelNamesInGroup(channels, groupId)
    const allSelected = areAllNamesSelected(channelsInGroup, selectedChannels)
    setSelectedChannels((prev) =>
      toggleNamesInSelection(prev, channelsInGroup, allSelected),
    )
  }

  const toggleTagSelection = (tag: string) => {
    const pseudoTag = findChannelPseudoTag(tag)
    const channelsWithTag = pseudoTag
      ? channels.filter((c) => pseudoTag.matches(c)).map((c) => c.name)
      : getChannelNamesWithTag(channels, tag)
    const allSelected = areAllNamesSelected(channelsWithTag, selectedChannels)
    setSelectedChannels((prev) =>
      toggleNamesInSelection(prev, channelsWithTag, allSelected),
    )
  }

  const isFilteringActive =
    selectedLanguageFilter.length > 0 ||
    selectedGroupFilter.length > 0 ||
    channelSearch.trim().length > 0

  return (
    <motion.div
      key="channels"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Unified Control Bar */}
      <div className="bg-app-card rounded-xl border border-app-ink/10 shadow-sm p-4 flex flex-col gap-4">
        <ChannelGridToolbar
          inlineChannelName={actions.inlineChannelName}
          onInlineChannelNameChange={actions.setInlineChannelName}
          onAddChannel={actions.handleAddChannel}
          channelSearch={channelSearch}
          onChannelSearchChange={setChannelSearch}
          tagSearch={tagSearch}
          onTagSearchChange={setTagSearch}
          hasChannels={channels.length > 0}
          onSelectAll={handleSelectAll}
          onUnselectAll={handleUnselectAll}
          onRevertSelection={handleRevertSelection}
          isRevertDisabled={filteredChannels.length === 0}
          isScraping={scrapingChannels.size > 0}
          isScrapeSelectedDisabled={
            isOffline ||
            scrapingChannels.size > 0 ||
            summarizing ||
            selectedChannels.size === 0
          }
          isScrapeAllDisabled={
            isOffline || scrapingChannels.size > 0 || summarizing
          }
          onScrapeSelected={handleScrapeSelected}
          onScrapeAll={handleScrapeAll}
        />

        {/* Group & tag filter rows */}
        {channels.length > 0 && (
          <div className="flex flex-col gap-3 pt-4 border-t border-app-ink/5">
            <ChannelGroupChips
              groups={sortedSettingGroups}
              channels={channels}
              selectedChannels={selectedChannels}
              activeGroupFilter={selectedGroupFilter}
              onToggleGroupSelection={toggleGroupSelection}
              onSetGroupFilter={setChannelGroupFilter}
            />

            <div className="flex flex-col gap-4">
              <ChannelTagChips
                channels={channels}
                selectedChannels={selectedChannels}
                visibleTags={visibleTags}
                pseudoTagChips={pseudoTagChips}
                onToggleTag={toggleTagSelection}
              />

              <ChannelGridFilterBar
                includeChannelBioInPrompt={includeChannelBioInPrompt}
                onIncludeChannelBioInPromptChange={setIncludeChannelBioInPrompt}
                includeChannelTagsInPrompt={includeChannelTagsInPrompt}
                onIncludeChannelTagsInPromptChange={
                  setIncludeChannelTagsInPrompt
                }
                isFilteringActive={isFilteringActive}
                filteredCount={filteredChannels.length}
                totalCount={channels.length}
                allLanguages={allLanguages}
                selectedLanguageFilter={selectedLanguageFilter}
                onLanguageFilterChange={setSelectedLanguageFilter}
                sortBy={sortBy}
                onSortByChange={setSortBy}
                sortDirection={sortDirection}
                onToggleSortDirection={() =>
                  setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
                }
                showChannelSubscribers={showChannelSubscribers}
                trimCount={trimCount}
                onTrimCountChange={setTrimCount}
                isTrimInputDisabled={selectedChannels.size === 0}
                isTrimDisabled={isTrimDisabled}
                onTrimSelection={handleTrimSelection}
                showSortRank={showSortRank}
                onShowSortRankChange={setShowSortRank}
              />
            </div>
          </div>
        )}

        {/* Bulk Actions */}
        {selectedChannels.size > 0 && (
          <ChannelBulkActions
            selectedCount={selectedChannels.size}
            onRequestFreeze={() => actions.setConfirmBulkFreezeAction("freeze")}
            onRequestUnfreeze={() =>
              actions.setConfirmBulkFreezeAction("unfreeze")
            }
            settingGroups={sortedSettingGroups}
            bulkTargetGroupId={actions.bulkTargetGroupId}
            onBulkTargetGroupIdChange={actions.setBulkTargetGroupId}
            onApplyMoveToGroup={() => void actions.applyBulkMoveToGroup()}
            bulkTagInput={actions.bulkTagInput}
            onBulkTagInputChange={actions.setBulkTagInput}
            onBulkAddTag={actions.handleBulkAddTag}
            bulkRemoveTagInput={actions.bulkRemoveTagInput}
            onBulkRemoveTagInputChange={actions.setBulkRemoveTagInput}
            onBulkRemoveTag={actions.handleBulkRemoveTag}
            onRequestDelete={() => actions.setConfirmBulkDelete(true)}
          />
        )}
      </div>

      <ChannelGridBody
        isLoading={isInitialChannelsLoading}
        totalChannelCount={channels.length}
        filteredChannelCount={filteredChannels.length}
        channels={sortedFilteredChannels}
        visibleCount={visibleChannels}
        showSortRank={showSortRank}
        selectedChannels={selectedChannels}
        selectedTrimRanks={selectedTrimRanks}
        postsInScopeCounts={postsInScopeCounts}
        onRemoveChannel={actions.handleRemoveChannel}
        onResetAndSync={actions.handleResetAndSync}
        hasMore={hasMoreChannels}
        onLoadMore={loadMoreChannels}
        scrollContainerRef={scrollContainerRef}
      />

      <ChannelGridDialogs
        confirmResetModal={actions.confirmResetModal}
        onCloseResetModal={() => actions.setConfirmResetModal(null)}
        onConfirmResetAndSync={actions.executeResetAndSync}
        confirmDeleteChannel={actions.confirmDeleteChannel}
        onCloseDeleteChannel={() => actions.setConfirmDeleteChannel(null)}
        onConfirmDeleteChannel={actions.executeDeleteChannel}
        confirmBulkDelete={actions.confirmBulkDelete}
        onBulkDeleteOpenChange={actions.setConfirmBulkDelete}
        onConfirmBulkDelete={actions.executeBulkDelete}
        selectedCount={selectedChannels.size}
        confirmBulkFreezeAction={actions.confirmBulkFreezeAction}
        onCloseBulkFreezeAction={() => actions.setConfirmBulkFreezeAction(null)}
        onConfirmBulkFreezeAction={actions.handleConfirmBulkFreezeAction}
      />
    </motion.div>
  )
}
