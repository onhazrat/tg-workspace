import { Languages, Layers, Search, Tag } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AiContextPill,
  SortMenu,
  SyncAllButton,
} from "@/components/channel-grid/ChannelBarControls"
import type { ConditionOptions } from "@/components/channel-grid/ChannelConditionPicker"
import {
  ChannelFacetMenu,
  type FacetRow,
} from "@/components/channel-grid/ChannelFacetMenu"
import { ChannelFilterRow } from "@/components/channel-grid/ChannelFilterRow"
import { ChannelGridBody } from "@/components/channel-grid/ChannelGridBody"
import { ChannelGridDialogs } from "@/components/channel-grid/ChannelGridDialogs"
import { ChannelMetricMenu } from "@/components/channel-grid/ChannelMetricMenu"
import { ChannelSelectionBar } from "@/components/channel-grid/ChannelSelectionBar"
import { channelGridGates } from "@/components/channel-grid/channel-grid-gates"
import { FollowPasteBox } from "@/components/channel-grid/FollowPasteBox"
import { useChannelGridActions } from "@/components/channel-grid/useChannelGridActions"
import { useChannelGridSortState } from "@/components/channel-grid/useChannelGridSortState"
import { useChannelTagUse } from "@/components/channel-grid/useChannelTagUse"
import {
  settingGroupGear,
  useOpenSettingGroup,
} from "@/components/filter-tree/GroupsDropdown"
import { requestSpotlight } from "@/components/post-card/ChannelSpotlight"
import { TgInput } from "@/components/ui/tg-input"
import { useScope } from "@/contexts/ScopeContext"
import { useScopedPostCounts } from "@/hooks/usePostsView"
import {
  useCreateSettingGroup,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { useWorkspaceGroupParams } from "@/hooks/useWorkspaceGroupParams"
import { bulkTagSuggestions } from "@/lib/channels/bulk-tag-suggestions"
import { cardFace } from "@/lib/channels/card-zoom"
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
  type MetricAtom,
  parseChannelFilter,
  printChannelFilter,
  removeFunnel,
  type TimeAtom,
} from "@/lib/channels/channel-filter"
import {
  areAllNamesSelected,
  collectGridTags,
  getChannelNamesInGroup,
  getChannelNamesInLanguage,
  getChannelNamesWithTag,
  toggleNamesInSelection,
} from "@/lib/channels/channel-grid-chips"
import {
  type MetricData,
  type MetricInputs,
  metricValues,
} from "@/lib/channels/channel-metrics"
import { momentValues } from "@/lib/channels/channel-moments"
import {
  buildChannelPseudoTagChips,
  CHANNEL_PSEUDO_TAGS,
  filterTagsBySearch,
} from "@/lib/channels/channel-tags"
import {
  collectChannelLanguages,
  filterChannelsForGrid,
} from "@/lib/channels/filter-channels-for-grid"
import { rangeSelect } from "@/lib/channels/range-select"
import { buildSelectedTrimRanks } from "@/lib/channels/selected-trim-ranks"
import {
  actionTargets,
  hiddenSelection,
  hiddenSelectionNote,
} from "@/lib/channels/selection-regions"
import { sortSettingGroupsForDisplay } from "@/lib/channels/setting-groups"
import { publishShownChannels } from "@/lib/channels/shown-channels"
import { sortChannelsForGrid } from "@/lib/channels/sort-channels-for-grid"
import { applyTrimChannelSelection } from "@/lib/channels/trim-selected-channels"
import { newTagValues } from "@/lib/tags/tag-use"
import { useData } from "../contexts/DataContext"
import { useSettings } from "../contexts/SettingsContext"
import { useSync } from "../contexts/SyncContext"
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

  const { summarizing, setActiveTab } = useUI()

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

  const settings = useSettings()
  const {
    showChannelSubscribers,
    channelCardZoom,
    setChannelCardZoom,
    channelGridGroupBySelection,
    setChannelGridGroupBySelection,
    channelActionLimit,
    setChannelActionLimit,
    includeChannelBio,
    setIncludeChannelBio,
    includeChannelTags,
    setIncludeChannelTags,
  } = settings

  const { isOffline } = useApiStatus()

  const {
    scrapingChannels,
    handleScrapeSelected,
    handleScrapeAll,
    runningSyncJobs,
    stopSync,
    followDiscoverChannels,
  } = useSync()

  const [channelSearch, setChannelSearch] = useState("")
  const [tagSearch, setTagSearch] = useState("")
  const { channelFilterText, setChannelFilterText } = useWorkspaceGroupParams()
  const openSettingGroup = useOpenSettingGroup()

  const { data: settingGroups = [] } = useSettingGroupsQuery()
  const createSettingGroup = useCreateSettingGroup()
  const sortedSettingGroups = useMemo(
    () => sortSettingGroupsForDisplay(settingGroups),
    [settingGroups],
  )

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
  // Every Tag a filter change adds is a Tag use, from whichever control.
  const tagUse = useChannelTagUse(channels)
  const setChannelFilter = (next: ChannelFilter) => {
    tagUse.record(...newTagValues(channelFilter, next))
    setChannelFilterText(printChannelFilter(next, filterLookup))
  }

  // Per-channel in-scope counts (SQL GROUP BY, client fallback for semantic).
  const postsInScopeCounts = useScopedPostCounts()

  // What the number and Time bound Conditions read. A Live Time bound is
  // judged against the Scope's server minute, so the grid re-filters on its
  // tick while the tab stays open (TB-03).
  const { minuteNow } = useScope()
  const metricInputs = useMemo<MetricInputs>(
    () => ({ channelStats, postsInScopeCounts, now: minuteNow }),
    [channelStats, postsInScopeCounts, minuteNow],
  )
  const metricData = useMemo<MetricData>(
    () => ({
      values: (key) => metricValues(key, channels, metricInputs),
      total: channels.length,
      moments: (key) => momentValues(key, channels, metricInputs),
    }),
    [channels, metricInputs],
  )
  const menuConditions = atoms(channelFilter).filter(
    (a): a is MetricAtom | TimeAtom =>
      a.cond.type === "metric" || a.cond.type === "time",
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

  // The action limit (CTB-04): row 2's actions, Trim and the sort rank reach
  // `targets`. The Scope, the Posts tab and every Artifact still read the
  // whole selection from DataContext, the Hidden selection included.
  const shownNames = useMemo(
    () => filteredChannels.map((channel) => channel.name),
    [filteredChannels],
  )
  const targets = useMemo(
    () => actionTargets(selectedChannels, shownNames, channelActionLimit),
    [selectedChannels, shownNames, channelActionLimit],
  )
  const hiddenCount = useMemo(
    () => hiddenSelection(selectedChannels, shownNames).size,
    [selectedChannels, shownNames],
  )

  useEffect(() => publishShownChannels(shownNames), [shownNames])
  useEffect(() => () => publishShownChannels(null), [])

  const actions = useChannelGridActions(targets)
  const channelNames = useMemo(
    () => channels.map((channel) => channel.name),
    [channels],
  )
  const suggestions = useMemo(
    () => bulkTagSuggestions(channels, targets),
    [channels, targets],
  )
  const tagSuggestions = useMemo(
    () => ({
      add: tagUse.order(
        suggestions.add,
        (s) => s.tag,
        (s) => s.total,
      ),
      remove: tagUse.order(
        suggestions.remove,
        (s) => s.tag,
        (s) => s.inTargets,
      ),
    }),
    [suggestions, tagUse.order],
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
        selectedChannels: targets,
        sortBy,
        sortDirection,
      }),
    [
      channelStats,
      channels,
      postsInScopeCounts,
      targets,
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
    selectedCount: targets.size,
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
      selectedChannels: targets,
      keep: [...selectedChannels].filter((name) => !targets.has(name)),
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
    targets,
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
  // DataContext, whose field set is pinned, and the selection edits leave it.
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

  const handleUnselectAll = () => {
    setSelectedChannels(new Set())
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

  const { order: orderTags } = tagUse
  const tagRows = useMemo<FacetRow[]>(
    () => [
      ...orderTags(visibleTags, (tag) => tag).map((tag) => ({
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
    [channels, orderTags, pseudoTagChips, visibleTags],
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

  // What the filter row's "+" offers: every tag, not only the ones the Tags
  // dropdown's search leaves.
  const conditionOptions = useMemo<ConditionOptions>(
    () => ({
      tag: [
        ...orderTags(allTags, (tag) => tag).map((tag) => ({
          id: tag,
          label: tag,
        })),
        ...CHANNEL_PSEUDO_TAGS.map((tag) => ({
          id: tag.id,
          label: tag.label,
          hint: "derived",
        })),
      ],
      group: groupRows,
      language: languageRows,
    }),
    [allTags, groupRows, languageRows, orderTags],
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
          <FollowPasteBox
            followed={channelNames}
            settingGroups={sortedSettingGroups}
            onFollow={(handles, settingGroupId, onProgress) =>
              followDiscoverChannels(
                handles.map((name) => ({ name })),
                { settingGroupId, onProgress },
              )
            }
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
              aria-label="Search channels"
              className="h-9 py-0 pl-9"
            />
          </div>
          <ChannelFacetMenu
            icon={<Layers size={12} />}
            label="Groups"
            noun="group"
            testId="channel-groups"
            rows={groupRows}
            onCreate={createSettingGroup}
            {...facet("group")}
            rowAction={settingGroupGear(openSettingGroup)}
          />
          <ChannelFacetMenu
            icon={<Tag size={12} />}
            label="Tags"
            noun="tag"
            testId="channel-tags"
            rows={tagRows}
            search={{ value: tagSearch, onChange: setTagSearch }}
            {...facet("tag")}
            onToggleSelect={(row) => {
              tagUse.record(row.id)
              toggleRowSelection(row)
            }}
            manage={tagUse.manage}
            freezeOrder
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
            conditions={menuConditions}
            data={metricData}
            onAdd={(cond) =>
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
            includeBio={includeChannelBio}
            onIncludeBioChange={setIncludeChannelBio}
            includeTags={includeChannelTags}
            onIncludeTagsChange={setIncludeChannelTags}
          />
          <SyncAllButton
            channels={channels}
            onSync={() => void handleScrapeAll()}
            running={runningSyncJobs.sync_all !== null}
            onStop={() => void stopSync("sync_all")}
            disabled={isScrapeAllDisabled}
            loading={scrapingChannels.size > 0}
          />
        </div>

        <ChannelFilterRow
          filter={channelFilter}
          search={channelSearch}
          shownCount={filteredChannels.length}
          totalCount={channels.length}
          names={filterLookup}
          metrics={metricData}
          options={conditionOptions}
          onChange={setChannelFilter}
          onClearSearch={() => setChannelSearch("")}
          onClearAll={() => {
            setChannelFilter(emptyFilter())
            setChannelSearch("")
          }}
        />

        <ChannelSelectionBar
          selection={selectedChannels}
          shown={shownNames}
          onSelectAll={() => setSelectedChannels(new Set(shownNames))}
          onSetSelection={setSelectedChannels}
          actionLimit={channelActionLimit}
          onActionLimitChange={setChannelActionLimit}
          onClear={handleUnselectAll}
          trimCount={trimCount}
          onTrimCountChange={setTrimCount}
          onTrim={handleTrimSelection}
          isTrimDisabled={isTrimDisabled}
          onSync={() => void handleScrapeSelected(targets)}
          isSyncDisabled={isScrapeSelectedDisabled}
          isSyncing={scrapingChannels.size > 0}
          syncJobRunning={runningSyncJobs.selected !== null}
          onStopSync={() => void stopSync("selected")}
          onFreeze={() => actions.setConfirmBulkFreezeAction("freeze")}
          onUnfreeze={() => actions.setConfirmBulkFreezeAction("unfreeze")}
          onDelete={() => actions.setConfirmBulkDelete(true)}
          settingGroups={sortedSettingGroups}
          moveTargetId={actions.bulkTargetGroupId}
          onMoveTargetChange={actions.setBulkTargetGroupId}
          onMove={() => void actions.applyBulkMoveToGroup()}
          tagInput={actions.bulkTagInput}
          onTagInputChange={actions.setBulkTagInput}
          onAddTag={() =>
            tagUse.afterTagging(actions.handleBulkAddTag, actions.bulkTagInput)
          }
          removeTagInput={actions.bulkRemoveTagInput}
          onRemoveTagInputChange={actions.setBulkRemoveTagInput}
          onRemoveTag={() =>
            tagUse.afterTagging(
              actions.handleBulkRemoveTag,
              actions.bulkRemoveTagInput,
            )
          }
          tagSuggestions={tagSuggestions}
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
        onFilterByTag={(tag) =>
          setChannelFilter(addFunnel(channelFilter, "tag", tag))
        }
        onRemoveChannel={actions.handleRemoveChannel}
        onResetAndSync={actions.handleResetAndSync}
        onSelectChannel={handleSelectChannel}
        hasMore={hasMoreChannels}
        onLoadMore={loadMoreChannels}
        scrollContainerRef={scrollContainerRef}
        onZoomChange={setChannelCardZoom}
        onSpotlight={(name) => {
          requestSpotlight(name)
          setActiveTab("posts")
        }}
        carried={cardFace(channelCardZoom, settings).keys}
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
        actionCount={targets.size}
        hiddenNote={hiddenSelectionNote(hiddenCount, channelActionLimit)}
        confirmBulkFreezeAction={actions.confirmBulkFreezeAction}
        onCloseBulkFreezeAction={() => actions.setConfirmBulkFreezeAction(null)}
        onConfirmBulkFreezeAction={actions.handleConfirmBulkFreezeAction}
      />
    </motion.div>
  )
}
