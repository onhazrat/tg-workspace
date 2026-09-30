import { Languages, Layers, RefreshCw, Search, Tag } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AiContextPill,
  FollowControl,
  SortMenu,
} from "@/components/channel-grid/ChannelBarControls"
import {
  ChannelFacetMenu,
  type FacetRow,
} from "@/components/channel-grid/ChannelFacetMenu"
import { ChannelFilterRow } from "@/components/channel-grid/ChannelFilterRow"
import { ChannelGridBody } from "@/components/channel-grid/ChannelGridBody"
import { ChannelGridDialogs } from "@/components/channel-grid/ChannelGridDialogs"
import type { MetricData } from "@/components/channel-grid/ChannelMetricEditor"
import { ChannelMetricMenu } from "@/components/channel-grid/ChannelMetricMenu"
import { ChannelSelectionBar } from "@/components/channel-grid/ChannelSelectionBar"
import { channelGridGates } from "@/components/channel-grid/channel-grid-gates"
import { useChannelGridActions } from "@/components/channel-grid/useChannelGridActions"
import { useChannelGridSortState } from "@/components/channel-grid/useChannelGridSortState"
import { TgButton } from "@/components/ui/tg-button"
import { TgInput } from "@/components/ui/tg-input"
import { useScopedPostCounts } from "@/hooks/usePostsView"
import { useWorkspaceGroupParams } from "@/hooks/useWorkspaceGroupParams"
import {
  addFunnel,
  append,
  atoms,
  type ChannelFilter,
  type CondType,
  clearFunnels,
  conditionLabel,
  emptyFilter,
  filterNames,
  funnelledValues,
  type MetricCond,
  parseChannelFilter,
  printChannelFilter,
  removeFunnel,
  removeNode,
  replaceNode,
} from "@/lib/channels/channel-filter"
import {
  areAllNamesSelected,
  collectGridTags,
  getChannelNamesInGroup,
  getChannelNamesInLanguage,
  getChannelNamesWithTag,
  toggleNamesInSelection,
} from "@/lib/channels/channel-grid-chips"
import { type MetricInputs, metricValues } from "@/lib/channels/channel-metrics"
import {
  buildChannelPseudoTagChips,
  filterTagsBySearch,
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
  const { channelFilterText, setChannelFilterText } = useWorkspaceGroupParams()

  const actions = useChannelGridActions()
  const { sortedSettingGroups } = actions

  // The Channel filter lives in the URL. A text that does not parse is
  // ignored, and replaced by the next edit.
  const filterLookup = useMemo(
    () => filterNames(sortedSettingGroups),
    [sortedSettingGroups],
  )
  const channelFilter = useMemo(
    () => parseChannelFilter(channelFilterText, filterLookup) ?? emptyFilter(),
    [channelFilterText, filterLookup],
  )
  const setChannelFilter = (next: ChannelFilter) =>
    setChannelFilterText(printChannelFilter(next, filterLookup))

  // Per-channel in-scope counts (SQL GROUP BY, client fallback for semantic).
  const postsInScopeCounts = useScopedPostCounts()

  // What the number Conditions read; days count from when the page loaded.
  const metricInputs = useMemo<MetricInputs>(
    () => ({ channelStats, postsInScopeCounts, now: performance.timeOrigin }),
    [channelStats, postsInScopeCounts],
  )
  const metricData = useMemo<MetricData>(
    () => ({
      values: (key) => metricValues(key, channels, metricInputs),
      total: channels.length,
    }),
    [channels, metricInputs],
  )
  const metricConditions = atoms(channelFilter).flatMap((a) =>
    a.cond.type === "metric" ? [a.cond] : [],
  )

  const filteredChannels = useMemo(
    () =>
      filterChannelsForGrid(channels, {
        filter: channelFilter,
        search: channelSearch,
        metrics: metricInputs,
      }),
    [channels, channelSearch, channelFilter, metricInputs],
  )

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
  } = channelGridGates({
    trimCount,
    selectedCount: selectedChannels.size,
    summarizing,
    scrapingCount: scrapingChannels.size,
    isOffline,
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
  }, [channelSearch, channelFilterText, sortBy, sortDirection])

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

  // A tick selects or deselects every Channel in a dropdown row.
  const toggleRowSelection = (row: FacetRow) => {
    const allSelected = areAllNamesSelected(row.names, selectedChannels)
    setSelectedChannels((prev) =>
      toggleNamesInSelection(prev, row.names, allSelected),
    )
  }

  const facet = (type: CondType) => ({
    selectedChannels,
    funnelled: funnelledValues(channelFilter, type),
    labelOf: (value: string) => conditionLabel({ type, value }, filterLookup),
    onToggleSelect: toggleRowSelection,
    onFunnel: (id: string, on: boolean) =>
      setChannelFilter(
        on
          ? addFunnel(channelFilter, type, id)
          : removeFunnel(channelFilter, type, id),
      ),
    onClearFunnels: () => setChannelFilter(clearFunnels(channelFilter, type)),
  })

  const groupRows = useMemo<FacetRow[]>(
    () =>
      sortedSettingGroups.map((group) => ({
        id: group.id,
        label: group.name,
        hint: group.isDefault ? "default" : undefined,
        names: getChannelNamesInGroup(channels, group.id),
      })),
    [channels, sortedSettingGroups],
  )

  const tagRows = useMemo<FacetRow[]>(
    () => [
      ...visibleTags.map((tag) => ({
        id: tag,
        label: tag,
        names: getChannelNamesWithTag(channels, tag),
      })),
      ...pseudoTagChips.map((chip) => ({
        id: chip.id,
        label: chip.label,
        explanation: chip.tooltip,
        names: chip.channelNames,
      })),
    ],
    [channels, pseudoTagChips, visibleTags],
  )

  const languageRows = useMemo<FacetRow[]>(
    () =>
      allLanguages.map((language) => ({
        id: language.code,
        label: language.name,
        hint: language.code,
        names: getChannelNamesInLanguage(channels, language.code),
      })),
    [allLanguages, channels],
  )

  return (
    <motion.div
      key="channels"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="rounded-xl border border-app-ink/10 bg-app-card shadow-sm">
        {/* Row 1: follow, find, filter, sort, sync */}
        <div className="flex flex-wrap items-center gap-2 p-3">
          <FollowControl
            value={actions.inlineChannelName}
            onChange={actions.setInlineChannelName}
            onFollow={actions.handleAddChannel}
          />
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={13}
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-3 my-auto text-app-ink/40"
            />
            <TgInput
              type="text"
              variant="muted"
              value={channelSearch}
              onChange={(e) => setChannelSearch(e.target.value)}
              placeholder="Search channels..."
              className="h-9 py-0 pl-9"
            />
          </div>
          <ChannelFacetMenu
            icon={<Layers size={12} />}
            label="Groups"
            noun="group"
            testId="channel-groups"
            rows={groupRows}
            {...facet("group")}
          />
          <ChannelFacetMenu
            icon={<Tag size={12} />}
            label="Tags"
            noun="tag"
            testId="channel-tags"
            rows={tagRows}
            search={{ value: tagSearch, onChange: setTagSearch }}
            {...facet("tag")}
          />
          {allLanguages.length > 0 && (
            <ChannelFacetMenu
              icon={<Languages size={12} />}
              label="Languages"
              noun="language"
              testId="channel-languages"
              rows={languageRows}
              {...facet("language")}
            />
          )}
          <ChannelMetricMenu
            conditions={metricConditions}
            data={metricData}
            onAdd={(cond: MetricCond) =>
              setChannelFilter(append(channelFilter, "root", cond))
            }
          />
          <SortMenu
            sortBy={sortBy}
            onSortByChange={setSortBy}
            sortDirection={sortDirection}
            onToggleSortDirection={() =>
              setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
            }
            showSubscribers={showChannelSubscribers}
          />
          <AiContextPill
            includeBio={includeChannelBioInPrompt}
            onIncludeBioChange={setIncludeChannelBioInPrompt}
            includeTags={includeChannelTagsInPrompt}
            onIncludeTagsChange={setIncludeChannelTagsInPrompt}
          />
          <TgButton
            type="button"
            size="sm"
            onClick={handleScrapeAll}
            disabled={isScrapeAllDisabled}
            loading={scrapingChannels.size > 0}
            className="h-9"
          >
            <RefreshCw size={12} />
            Sync all
          </TgButton>
        </div>

        <ChannelFilterRow
          filter={channelFilter}
          search={channelSearch}
          shownCount={filteredChannels.length}
          totalCount={channels.length}
          names={filterLookup}
          metrics={metricData}
          onRemove={(id) => setChannelFilter(removeNode(channelFilter, id))}
          onReplace={(id, cond) => {
            const node = atoms(channelFilter).find((a) => a.id === id)
            if (node)
              setChannelFilter(
                replaceNode(channelFilter, id, { ...node, cond }),
              )
          }}
          onClearSearch={() => setChannelSearch("")}
          onClearAll={() => {
            setChannelFilter(emptyFilter())
            setChannelSearch("")
          }}
        />

        <ChannelSelectionBar
          selectedCount={selectedChannels.size}
          shownCount={filteredChannels.length}
          onSelectAll={handleSelectAll}
          onInvert={handleRevertSelection}
          isInvertDisabled={filteredChannels.length === 0}
          onClear={handleUnselectAll}
          trimCount={trimCount}
          onTrimCountChange={setTrimCount}
          onTrim={handleTrimSelection}
          isTrimDisabled={isTrimDisabled}
          onSync={handleScrapeSelected}
          isSyncDisabled={isScrapeSelectedDisabled}
          isSyncing={scrapingChannels.size > 0}
          onFreeze={() => actions.setConfirmBulkFreezeAction("freeze")}
          onUnfreeze={() => actions.setConfirmBulkFreezeAction("unfreeze")}
          onDelete={() => actions.setConfirmBulkDelete(true)}
          settingGroups={sortedSettingGroups}
          moveTargetId={actions.bulkTargetGroupId}
          onMoveTargetChange={actions.setBulkTargetGroupId}
          onMove={() => void actions.applyBulkMoveToGroup()}
          tagInput={actions.bulkTagInput}
          onTagInputChange={actions.setBulkTagInput}
          onAddTag={actions.handleBulkAddTag}
          removeTagInput={actions.bulkRemoveTagInput}
          onRemoveTagInputChange={actions.setBulkRemoveTagInput}
          onRemoveTag={actions.handleBulkRemoveTag}
          groupBySelection={channelGridGroupBySelection}
          onToggleGroupBySelection={() =>
            setChannelGridGroupBySelection(!channelGridGroupBySelection)
          }
          showSortRank={showSortRank}
          onShowSortRankChange={setShowSortRank}
          zoom={channelCardZoom}
          onZoomChange={setChannelCardZoom}
        />
      </div>

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
