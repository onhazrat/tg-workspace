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
import { channelGridGates } from "@/components/channel-grid/channel-grid-gates"
import {
  logicKindFor,
  PrototypeControls,
  usePrototypeVariant,
} from "@/components/channel-grid/prototype"
import {
  buildConditions,
  DEFAULT_LOGIC,
  type FilterLogic,
  passesLogic,
} from "@/components/channel-grid/prototype/logic"
import type { NumericFilter } from "@/components/channel-grid/prototype/metrics"
import {
  append,
  atoms,
  emptyTree,
  evalNode,
  type GroupNode,
  makeNames,
  removeWhere,
  syncValues,
  valuesOf,
} from "@/components/channel-grid/prototype/tree"
import type { ChannelControlsProps } from "@/components/channel-grid/prototype/types"
import { useChannelGridActions } from "@/components/channel-grid/useChannelGridActions"
import { useChannelGridSortState } from "@/components/channel-grid/useChannelGridSortState"
import { useScopedPostCounts } from "@/hooks/usePostsView"
import { useWorkspaceGroupParams } from "@/hooks/useWorkspaceGroupParams"
import {
  areAllNamesSelected,
  collectGridTags,
  getChannelNamesInGroup,
  getChannelNamesWithTag,
  toggleNamesInSelection,
} from "@/lib/channels/channel-grid-chips"
import {
  buildChannelPseudoTagChips,
  CHANNEL_PSEUDO_TAGS,
  filterTagsBySearch,
  findChannelPseudoTag,
} from "@/lib/channels/channel-tags"
import {
  collectChannelLanguages,
  filterChannelsForGrid,
} from "@/lib/channels/filter-channels-for-grid"
import { rangeSelect } from "@/lib/channels/range-select"
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

  const {
    showChannelSubscribers,
    channelCardZoom,
    setChannelCardZoom,
    channelGridGroupBySelection,
    setChannelGridGroupBySelection,
  } = useSettings()

  const { isOffline } = useApiStatus()

  const { scrapingChannels, handleScrapeSelected, handleScrapeAll } =
    useScraper()

  const [channelSearch, setChannelSearch] = useState("")
  const [tagSearch, setTagSearch] = useState("")
  const [selectedLanguageFilter, setSelectedLanguageFilter] =
    useState<string>("")
  const { channelGroupFilter, setChannelGroupFilter } =
    useWorkspaceGroupParams()
  const selectedGroupFilter = channelGroupFilter

  const actions = useChannelGridActions()
  const { sortedSettingGroups } = actions

  // PROTOTYPE, throwaway: the variants funnel several values per facet. OR
  // within a facet, AND across facets; today's single-value filters are
  // ignored while a variant is showing.
  const { current: prototypeVariant, setVariant } = usePrototypeVariant()
  const isPrototype = prototypeVariant !== "current"
  const [protoGroupFilters, setProtoGroupFilters] = useState<string[]>([])
  const [protoTagFilters, setProtoTagFilters] = useState<string[]>([])
  const [protoLanguageFilters, setProtoLanguageFilters] = useState<string[]>([])
  const [protoNumericFilters, setProtoNumericFilters] = useState<
    NumericFilter[]
  >([])
  const [protoLogic, setProtoLogic] = useState<FilterLogic>(DEFAULT_LOGIC)
  const logicKind = logicKindFor(prototypeVariant)
  const isTree = logicKind === "tree"
  const [protoTree, setProtoTree] = useState<GroupNode>(emptyTree)
  const treeNames = useMemo(
    () => makeNames(sortedSettingGroups, CHANNEL_PSEUDO_TAGS),
    [sortedSettingGroups],
  )

  // Per-channel in-scope counts (SQL GROUP BY, client fallback for semantic).
  const postsInScopeCounts = useScopedPostCounts()
  const metricInputs = useMemo(
    () => ({ channelStats, postsInScopeCounts, now: Date.now() }),
    [channelStats, postsInScopeCounts],
  )

  const filteredChannels = useMemo(() => {
    const byFacets = filterChannelsForGrid(channels, {
      groupFilter: isPrototype ? "" : selectedGroupFilter,
      languageFilter: isPrototype ? "" : selectedLanguageFilter,
      search: channelSearch,
    })
    if (!isPrototype) return byFacets
    const conds = buildConditions(
      {
        groups: protoGroupFilters,
        tags: protoTagFilters,
        languages: protoLanguageFilters,
        numeric: protoNumericFilters,
        metricInputs,
      },
      logicKind,
      protoLogic,
    )
    if (isTree)
      return byFacets.filter((c) => evalNode(protoTree, c, metricInputs))
    return byFacets.filter((c) => passesLogic(c, conds, logicKind, protoLogic))
  }, [
    channels,
    channelSearch,
    selectedLanguageFilter,
    selectedGroupFilter,
    isPrototype,
    protoGroupFilters,
    protoLanguageFilters,
    protoTagFilters,
    protoNumericFilters,
    metricInputs,
    logicKind,
    protoLogic,
    isTree,
    protoTree,
  ])

  const sortedFilteredChannels = useMemo(
    () =>
      sortChannelsForGrid({
        channels: filteredChannels,
        channelStats,
        postsInScopeCounts,
        selectedChannels,
        sortBy,
        sortDirection,
        groupBySelection: channelGridGroupBySelection,
      }),
    [
      channelGridGroupBySelection,
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

  const {
    parsedTrimCount,
    isTrimDisabled,
    isScrapeSelectedDisabled,
    isScrapeAllDisabled,
    isFilteringActive,
  } = channelGridGates({
    trimCount,
    selectedCount: selectedChannels.size,
    summarizing,
    scrapingCount: scrapingChannels.size,
    isOffline,
    languageFilter: selectedLanguageFilter,
    groupFilter: selectedGroupFilter,
    search: channelSearch,
  })

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

  // The cards on screen, and the order a shift-click run is measured in.
  // Load-more resets to one page on a sort or search change, which can leave
  // the anchor past the last of them.
  const renderedChannels = useMemo(
    () => sortedFilteredChannels.slice(0, visibleChannels),
    [sortedFilteredChannels, visibleChannels],
  )

  const loadMoreChannels = useCallback(() => {
    setVisibleChannels((prev) => Math.min(prev + 20, filteredChannels.length))
  }, [filteredChannels.length])

  useEffect(() => {
    setVisibleChannels(20)
  }, [
    channelSearch,
    selectedLanguageFilter,
    selectedGroupFilter,
    protoGroupFilters,
    protoLanguageFilters,
    protoTagFilters,
    protoNumericFilters,
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

  // The last Channel clicked, plain or shift. It lives here rather than in
  // DataContext, whose field set is pinned, and All, None and Revert leave it.
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)

  const handleSelectChannel = (name: string, shift: boolean) => {
    const result = rangeSelect({
      selection: selectedChannels,
      order: renderedChannels.map((channel) => channel.name),
      anchor: selectionAnchor,
      clicked: name,
      shift,
    })
    setSelectedChannels(result.selection)
    setSelectionAnchor(result.anchor)
  }

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

  // PROTOTYPE, throwaway: every capability of the control section in one bag.
  const prototypeControls: ChannelControlsProps = {
    inlineChannelName: actions.inlineChannelName,
    onInlineChannelNameChange: actions.setInlineChannelName,
    onAddChannel: actions.handleAddChannel,
    // Only the variants call it, and `stubWrites` always replaces it there.
    onFollowNames: () => {},
    channelSearch,
    onChannelSearchChange: setChannelSearch,
    tagSearch,
    onTagSearchChange: setTagSearch,
    channels,
    hasChannels: channels.length > 0,
    totalCount: channels.length,
    filteredCount: filteredChannels.length,
    isFilteringActive:
      channelSearch.trim() !== "" ||
      protoGroupFilters.length +
        protoTagFilters.length +
        protoLanguageFilters.length +
        protoNumericFilters.length >
        0,
    selectedChannels,
    onSelectAll: handleSelectAll,
    onUnselectAll: handleUnselectAll,
    onRevertSelection: handleRevertSelection,
    isRevertDisabled: filteredChannels.length === 0,
    isScraping: scrapingChannels.size > 0,
    isScrapeSelectedDisabled,
    isScrapeAllDisabled,
    onScrapeSelected: handleScrapeSelected,
    onScrapeAll: handleScrapeAll,
    zoom: channelCardZoom,
    onZoomChange: setChannelCardZoom,
    groups: sortedSettingGroups,
    // T1-T3: the dropdowns read and write the tree instead of their lists.
    groupFilters: isTree ? valuesOf(protoTree, "group") : protoGroupFilters,
    onGroupFiltersChange: isTree
      ? (next) => setProtoTree((t) => syncValues(t, "group", next))
      : setProtoGroupFilters,
    onToggleGroupSelection: toggleGroupSelection,
    visibleTags,
    pseudoTagChips,
    onToggleTag: toggleTagSelection,
    tagFilters: isTree ? valuesOf(protoTree, "tag") : protoTagFilters,
    onTagFiltersChange: isTree
      ? (next) => setProtoTree((t) => syncValues(t, "tag", next))
      : setProtoTagFilters,
    includeChannelBioInPrompt,
    onIncludeChannelBioInPromptChange: setIncludeChannelBioInPrompt,
    includeChannelTagsInPrompt,
    onIncludeChannelTagsInPromptChange: setIncludeChannelTagsInPrompt,
    allLanguages,
    languageFilters: isTree
      ? valuesOf(protoTree, "language")
      : protoLanguageFilters,
    onLanguageFiltersChange: isTree
      ? (next) => setProtoTree((t) => syncValues(t, "language", next))
      : setProtoLanguageFilters,
    numericFilters: isTree
      ? atoms(protoTree).flatMap((a) =>
          a.cond.type === "metric" ? [a.cond] : [],
        )
      : protoNumericFilters,
    onNumericFiltersChange: isTree
      ? (next) =>
          setProtoTree((t) =>
            removeWhere(
              t,
              (c) =>
                c.type === "metric" &&
                !next.some(
                  (f) =>
                    f.metric === c.metric && f.min === c.min && f.max === c.max,
                ),
            ),
          )
      : setProtoNumericFilters,
    onAddNumeric: isTree
      ? (f) => setProtoTree((t) => append(t, "root", { type: "metric", ...f }))
      : undefined,
    filterTree: protoTree,
    onFilterTreeChange: setProtoTree,
    treeNames,
    metricInputs,
    logicKind,
    filterLogic: protoLogic,
    onFilterLogicChange: setProtoLogic,
    onToggleLanguageSelection: (code: string) => {
      const names = channels
        .filter((c) => c.language === code)
        .map((c) => c.name)
      const allSelected = areAllNamesSelected(names, selectedChannels)
      setSelectedChannels((prev) =>
        toggleNamesInSelection(prev, names, allSelected),
      )
    },
    sortBy,
    onSortByChange: setSortBy,
    sortDirection,
    onToggleSortDirection: () =>
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc")),
    groupBySelection: channelGridGroupBySelection,
    onToggleGroupBySelection: () =>
      setChannelGridGroupBySelection(!channelGridGroupBySelection),
    showChannelSubscribers,
    trimCount,
    onTrimCountChange: setTrimCount,
    isTrimInputDisabled: selectedChannels.size === 0,
    isTrimDisabled,
    onTrimSelection: handleTrimSelection,
    showSortRank,
    onShowSortRankChange: setShowSortRank,
    onRequestFreeze: () => actions.setConfirmBulkFreezeAction("freeze"),
    onRequestUnfreeze: () => actions.setConfirmBulkFreezeAction("unfreeze"),
    onRequestDelete: () => actions.setConfirmBulkDelete(true),
    bulkTargetGroupId: actions.bulkTargetGroupId,
    onBulkTargetGroupIdChange: actions.setBulkTargetGroupId,
    onApplyMoveToGroup: () => void actions.applyBulkMoveToGroup(),
    bulkTagInput: actions.bulkTagInput,
    onBulkTagInputChange: actions.setBulkTagInput,
    onBulkAddTag: actions.handleBulkAddTag,
    bulkRemoveTagInput: actions.bulkRemoveTagInput,
    onBulkRemoveTagInputChange: actions.setBulkRemoveTagInput,
    onBulkRemoveTag: actions.handleBulkRemoveTag,
  }

  return (
    <motion.div
      key="channels"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <PrototypeControls
        variant={prototypeVariant}
        onVariantChange={setVariant}
        controls={prototypeControls}
      />
      {/* Unified Control Bar */}
      {prototypeVariant === "current" && (
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
            isScrapeSelectedDisabled={isScrapeSelectedDisabled}
            isScrapeAllDisabled={isScrapeAllDisabled}
            onScrapeSelected={handleScrapeSelected}
            onScrapeAll={handleScrapeAll}
            zoom={channelCardZoom}
            onZoomChange={setChannelCardZoom}
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
                  onIncludeChannelBioInPromptChange={
                    setIncludeChannelBioInPrompt
                  }
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
                    setSortDirection((prev) =>
                      prev === "asc" ? "desc" : "asc",
                    )
                  }
                  groupBySelection={channelGridGroupBySelection}
                  onToggleGroupBySelection={() =>
                    setChannelGridGroupBySelection(!channelGridGroupBySelection)
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
              onRequestFreeze={() =>
                actions.setConfirmBulkFreezeAction("freeze")
              }
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
      )}

      <ChannelGridBody
        isLoading={isInitialChannelsLoading}
        totalChannelCount={channels.length}
        filteredChannelCount={filteredChannels.length}
        channels={renderedChannels}
        showSortRank={showSortRank}
        zoom={channelCardZoom}
        selectedChannels={selectedChannels}
        selectedTrimRanks={selectedTrimRanks}
        postsInScopeCounts={postsInScopeCounts}
        onRemoveChannel={actions.handleRemoveChannel}
        onResetAndSync={actions.handleResetAndSync}
        onSelectChannel={handleSelectChannel}
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
