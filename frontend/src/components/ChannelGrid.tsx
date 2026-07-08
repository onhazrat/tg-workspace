import {
  ArrowDown,
  ArrowUp,
  Layers,
  RefreshCw,
  Send,
  ShieldAlert,
  Tag,
} from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "@/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { useSummarizerGroupParams } from "@/hooks/useSummarizerGroupParams"
import { addChannelByName } from "@/lib/channels/add-channel"
import {
  addManualTag,
  getTagNames,
  removeTagsByName,
} from "@/lib/channels/channel-tag-model"
import {
  filterUntaggedChannels,
  sortTagsForChannelGrid,
  UNTAGGED_TAG_ID,
  UNTAGGED_TAG_LABEL,
} from "@/lib/channels/channel-tags"
import { deleteChannelByRecord } from "@/lib/channels/delete-channel"
import {
  findFrozenReservedGroup,
  sortSettingGroupsForDisplay,
} from "@/lib/channels/setting-groups"
import {
  type ChannelGridSortOption,
  sortChannelsForGrid,
} from "@/lib/channels/sort-channels-for-grid"
import { applyTrimChannelSelection } from "@/lib/channels/trim-selected-channels"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { useApiStatus } from "../hooks/useApiStatus"
import { useScrollLoadMore } from "../hooks/useScrollLoadMore"
import { clearChannelPosts, upsertChannel } from "../lib/repository"
import type { Channel } from "../types"
import { ChannelCard } from "./ChannelCard"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

type ChannelGridProps = {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

export const ChannelGrid: React.FC<ChannelGridProps> = ({
  scrollContainerRef,
}) => {
  const {
    channels,
    isInitialChannelsLoading,
    setChannels,
    channelStats,
    selectedChannels,
    setSelectedChannels,
    loadChannels,
    loadDBStats,
    loadNetworkLogs,
  } = useData()

  const {
    summarizing,
    includeChannelBioInPrompt,
    setIncludeChannelBioInPrompt,
    includeChannelTagsInPrompt,
    setIncludeChannelTagsInPrompt,
  } = useUI()

  const [sortBy, setSortBy] = useState<ChannelGridSortOption>(() => {
    const saved = localStorage.getItem("channelGrid_sortBy")
    return (saved as ChannelGridSortOption) || "last_updated"
  })
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(() => {
    const saved = localStorage.getItem("channelGrid_sortDirection")
    return (saved as "asc" | "desc") || "desc"
  })
  const [trimCount, setTrimCount] = useState(() => {
    return localStorage.getItem("channelGrid_trimCount") ?? ""
  })

  useEffect(() => {
    localStorage.setItem("channelGrid_sortBy", sortBy)
  }, [sortBy])

  useEffect(() => {
    localStorage.setItem("channelGrid_sortDirection", sortDirection)
  }, [sortDirection])

  useEffect(() => {
    if (trimCount.trim()) {
      localStorage.setItem("channelGrid_trimCount", trimCount)
    }
  }, [trimCount])

  const {
    proxyEnabled,
    defaultProxyUrls,
    torEnabled,
    torMode,
    torProxyUrls,
    torAutoRotate,
    torRotationThreshold,
    getEffectiveGlobalStartTime,
    showChannelSubscribers,
  } = useSettings()

  const { isOffline } = useApiStatus()

  const {
    scrapingChannels,
    handleScrapeSelected,
    handleScrapeAll,
    addToSyncQueue,
  } = useScraper()

  const [inlineChannelName, setInlineChannelName] = useState("")
  const [channelSearch, setChannelSearch] = useState("")
  const [selectedLanguageFilter, setSelectedLanguageFilter] =
    useState<string>("")
  const { channelGroupFilter, setChannelGroupFilter } =
    useSummarizerGroupParams()
  const selectedGroupFilter = channelGroupFilter
  const [bulkTagInput, setBulkTagInput] = useState("")
  const [bulkRemoveTagInput, setBulkRemoveTagInput] = useState("")
  const [confirmResetModal, setConfirmResetModal] = useState<Channel | null>(
    null,
  )
  const [confirmBulkFreezeAction, setConfirmBulkFreezeAction] = useState<
    "freeze" | "unfreeze" | null
  >(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const { data: settingGroups = [] } = useSettingGroupsQuery()
  const invalidateSettingGroups = useInvalidateSettingGroups()
  const [bulkTargetGroupId, setBulkTargetGroupId] = useState("")

  useEffect(() => {
    const defaultGroup =
      settingGroups.find((group) => group.isDefault) ?? settingGroups[0]
    if (defaultGroup && !bulkTargetGroupId) {
      setBulkTargetGroupId(defaultGroup.id)
    }
  }, [bulkTargetGroupId, settingGroups])

  const filteredChannels = useMemo(() => {
    let result = channels
    if (selectedGroupFilter) {
      result = result.filter(
        (channel) => channel.settingGroupId === selectedGroupFilter,
      )
    }
    if (selectedLanguageFilter) {
      result = result.filter((c) => c.language === selectedLanguageFilter)
    }
    if (channelSearch.trim()) {
      const query = channelSearch.toLowerCase()
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.displayName?.toLowerCase().includes(query) ||
          getTagNames(c.tags).some((t) => t.toLowerCase().includes(query)),
      )
    }
    return result
  }, [channels, channelSearch, selectedLanguageFilter, selectedGroupFilter])

  const sortedFilteredChannels = useMemo(
    () =>
      sortChannelsForGrid({
        channels: filteredChannels,
        channelStats,
        selectedChannels,
        sortBy,
        sortDirection,
      }),
    [channelStats, filteredChannels, selectedChannels, sortBy, sortDirection],
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

  const loadMoreSentinelRef = useScrollLoadMore({
    scrollContainerRef,
    enabled: !isInitialChannelsLoading && filteredChannels.length > 0,
    hasMore: hasMoreChannels,
    onLoadMore: loadMoreChannels,
  })

  useEffect(() => {
    setVisibleChannels(20)
  }, [
    channelSearch,
    selectedLanguageFilter,
    selectedGroupFilter,
    sortBy,
    sortDirection,
  ])

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    channels.forEach((c) => {
      getTagNames(c.tags).forEach((t) => tags.add(t))
    })
    return sortTagsForChannelGrid(Array.from(tags), channels, selectedChannels)
  }, [channels, selectedChannels])

  const untaggedChannelNames = useMemo(
    () => filterUntaggedChannels(channels).map((c) => c.name),
    [channels],
  )

  const selectableUntaggedChannelNames = useMemo(
    () =>
      filterUntaggedChannels(channels)
        .filter((c) => !c.isFrozen)
        .map((c) => c.name),
    [channels],
  )

  const allLanguages = useMemo(() => {
    const langs = new Set<string>()
    channels.forEach((c) => {
      if (c.language) langs.add(c.language)
    })
    return Array.from(langs).sort()
  }, [channels])

  const handleSelectAll = () => {
    setSelectedChannels(
      new Set(filteredChannels.filter((c) => !c.isFrozen).map((c) => c.name)),
    )
  }

  const handleUnselectAll = () => {
    setSelectedChannels(new Set())
  }

  const handleRevertSelection = () => {
    const selectable = filteredChannels.filter((c) => !c.isFrozen)
    setSelectedChannels((prev) => {
      const next = new Set(prev)
      for (const channel of selectable) {
        if (next.has(channel.name)) {
          next.delete(channel.name)
        } else {
          next.add(channel.name)
        }
      }
      return next
    })
  }

  const sortedSettingGroups = useMemo(
    () => sortSettingGroupsForDisplay(settingGroups),
    [settingGroups],
  )

  const toggleGroupSelection = (groupId: string) => {
    const channelsInGroup = channels
      .filter(
        (channel) => channel.settingGroupId === groupId && !channel.isFrozen,
      )
      .map((channel) => channel.name)
    const allSelected = channelsInGroup.every((name) =>
      selectedChannels.has(name),
    )

    setSelectedChannels((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        channelsInGroup.forEach((name) => next.delete(name))
      } else {
        channelsInGroup.forEach((name) => next.add(name))
      }
      return next
    })
  }

  const toggleTagSelection = (tag: string) => {
    const channelsWithTag =
      tag === UNTAGGED_TAG_ID
        ? selectableUntaggedChannelNames
        : channels
            .filter((c) => getTagNames(c.tags).includes(tag) && !c.isFrozen)
            .map((c) => c.name)
    const allSelected = channelsWithTag.every((name) =>
      selectedChannels.has(name),
    )

    setSelectedChannels((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        channelsWithTag.forEach((name) => next.delete(name))
      } else {
        channelsWithTag.forEach((name) => next.add(name))
      }
      return next
    })
  }

  const _toggleChannelSelection = (name: string) => {
    const channel = channels.find((c) => c.name === name)
    if (channel?.isFrozen) return

    setSelectedChannels((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const untaggedTagSelectedCount = untaggedChannelNames.filter((name) =>
    selectedChannels.has(name),
  ).length
  const isUntaggedTagAllSelected =
    untaggedTagSelectedCount === untaggedChannelNames.length &&
    untaggedChannelNames.length > 0
  const isUntaggedTagPartial =
    untaggedTagSelectedCount > 0 &&
    untaggedTagSelectedCount < untaggedChannelNames.length

  const selectedChannelIds = useMemo(
    () =>
      channels
        .filter((channel) => selectedChannels.has(channel.name))
        .map((channel) => channel.id),
    [channels, selectedChannels],
  )

  const defaultGroupId = useMemo(
    () => settingGroups.find((group) => group.isDefault)?.id ?? "",
    [settingGroups],
  )

  const frozenGroupId = useMemo(
    () => findFrozenReservedGroup(settingGroups)?.id ?? "",
    [settingGroups],
  )

  const applyBulkGroupAssignment = async (settingGroupId: string) => {
    if (!settingGroupId || selectedChannelIds.length === 0) return
    await api.bulkAssignSettingGroup({
      channelIds: selectedChannelIds,
      settingGroupId,
    })
    const group = settingGroups.find((item) => item.id === settingGroupId)
    if (!group) {
      await loadChannels()
      return
    }
    setChannels((prev) =>
      prev.map((channel) =>
        selectedChannelIds.includes(channel.id)
          ? {
              ...channel,
              settingGroupId: group.id,
              settingGroupName: group.name,
              regularSyncEnabled: group.regularSyncEnabled,
              dynamicSyncEnabled: group.dynamicSyncEnabled,
              autoSyncIntervalMinutes: group.autoSyncIntervalMinutes,
              dynamicSyncExpectedPosts: group.dynamicSyncExpectedPosts,
              autoFollowForwarded: group.autoFollowForwarded,
              isFrozen: group.isFrozen,
              isUnavailableOnWebView: group.isUnavailableOnWebView,
            }
          : channel,
      ),
    )
    await invalidateSettingGroups()
  }

  const [confirmDeleteChannel, setConfirmDeleteChannel] =
    useState<Channel | null>(null)

  const isFilteringActive =
    selectedLanguageFilter.length > 0 ||
    selectedGroupFilter.length > 0 ||
    channelSearch.trim().length > 0

  const selectTriggerClassName =
    "h-7 w-auto min-w-[96px] rounded-md border-app-ink/15 bg-app-card/70 px-2 text-[10px] font-bold uppercase tracking-widest text-app-ink shadow-none focus-visible:ring-app-ink/30 data-[placeholder]:text-app-ink/50"

  const handleRemoveChannel = (channel: Channel) => {
    setConfirmDeleteChannel(channel)
  }

  const executeDeleteChannel = async () => {
    if (!confirmDeleteChannel) return
    await deleteChannelByRecord(confirmDeleteChannel, {
      setSelectedChannels,
      loadChannels,
      loadDBStats,
    })
    setConfirmDeleteChannel(null)
  }

  const handleBulkFreeze = async () => {
    if (!frozenGroupId) return
    await applyBulkGroupAssignment(frozenGroupId)
  }

  const handleConfirmBulkFreezeAction = async () => {
    if (confirmBulkFreezeAction === "freeze") {
      await handleBulkFreeze()
    }
    if (confirmBulkFreezeAction === "unfreeze") {
      await handleBulkUnfreeze()
    }
    setConfirmBulkFreezeAction(null)
  }

  const handleBulkUnfreeze = async () => {
    if (!defaultGroupId) return
    await applyBulkGroupAssignment(defaultGroupId)
  }

  const handleBulkAddTag = async () => {
    if (!bulkTagInput.trim()) return
    const tag = bulkTagInput.trim()
    const updatedChannels = channels.map((c) => {
      if (selectedChannels.has(c.name)) {
        const normalizedNewTags = addManualTag(c.tags, tag)
        return { ...c, tags: normalizedNewTags }
      }
      return c
    })
    setChannels(updatedChannels)
    for (const c of updatedChannels) {
      if (selectedChannels.has(c.name)) {
        await upsertChannel(c)
      }
    }
    setBulkTagInput("")
  }

  const handleBulkRemoveTag = async () => {
    if (!bulkRemoveTagInput.trim()) return
    const tag = bulkRemoveTagInput.trim()
    const updatedChannels = channels.map((c) => {
      if (selectedChannels.has(c.name)) {
        const newTags = removeTagsByName(c.tags, [tag])
        return { ...c, tags: newTags }
      }
      return c
    })
    setChannels(updatedChannels)
    for (const c of updatedChannels) {
      if (selectedChannels.has(c.name)) {
        await upsertChannel(c)
      }
    }
    setBulkRemoveTagInput("")
  }

  const executeBulkDelete = async () => {
    for (const name of Array.from(selectedChannels)) {
      const channel = channels.find((entry) => entry.name === name)
      if (!channel) continue
      await deleteChannelByRecord(channel, {
        setSelectedChannels,
        loadChannels,
        loadDBStats,
      })
    }
    setSelectedChannels(new Set())
    setConfirmBulkDelete(false)
  }

  const handleResetAndSync = async (channel: Channel) => {
    setConfirmResetModal(channel)
  }

  const applyBulkMoveToGroup = async () => {
    await applyBulkGroupAssignment(bulkTargetGroupId)
  }

  const executeResetAndSync = async () => {
    if (!confirmResetModal) return
    try {
      await api.bulkResetSync({
        confirm: true,
        channelIds: [confirmResetModal.id],
      })
      await clearChannelPosts(confirmResetModal.name)
      await loadChannels()
    } catch (err) {
      console.error("Reset & sync failed:", err)
      await clearChannelPosts(confirmResetModal.name)
      addToSyncQueue(confirmResetModal, "Manual (Reset & Sync)", () => {})
    }
    setConfirmResetModal(null)
  }

  const handleAddChannel = async () => {
    if (!inlineChannelName) return
    const result = await addChannelByName(inlineChannelName, {
      channels,
      setSelectedChannels,
      loadChannels,
      loadNetworkLogs,
      addToSyncQueue,
      getEffectiveGlobalStartTime,
      settings: {
        proxyEnabled,
        defaultProxyUrls,
        torEnabled,
        torMode,
        torProxyUrls,
        torAutoRotate,
        torRotationThreshold,
      },
    })
    if (result.ok) setInlineChannelName("")
  }

  return (
    <motion.div
      key="channels"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Unified Control Bar */}
      <div className="bg-app-card rounded-xl border border-app-ink/10 shadow-sm p-4 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row flex-1 gap-2 max-w-2xl">
            {/* Modern Input */}
            <div className="relative flex-1" id="tour-add-channel">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-app-ink/40 font-bold">@</span>
              </div>
              <input
                type="text"
                value={inlineChannelName}
                onChange={(e) => setInlineChannelName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddChannel()}
                placeholder="telegram_channel"
                className="w-full bg-app-muted/50 border border-app-ink/10 rounded-lg py-2 pl-8 pr-20 text-sm focus:outline-none focus:ring-2 focus:ring-app-ink/20 transition-all"
              />
              <button
                type="button"
                onClick={handleAddChannel}
                disabled={!inlineChannelName.trim()}
                className="absolute inset-y-1 right-1 px-4 bg-app-ink text-app-bg text-[10px] uppercase font-bold rounded-md hover:opacity-90 transition-opacity disabled:opacity-30"
              >
                Add
              </button>
            </div>
            {/* Search Channels Input */}
            <div className="relative flex-1">
              <input
                type="text"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                placeholder="Search channels..."
                className="w-full bg-app-muted/50 border border-app-ink/10 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-app-ink/20 transition-all"
              />
            </div>
          </div>

          {/* Action Grouping */}
          {channels.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex bg-app-muted/50 p-1 rounded-lg border border-app-ink/5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md hover:bg-app-card hover:shadow-sm transition-all text-app-ink/70 hover:text-app-ink"
                    >
                      All
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Select All</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleUnselectAll}
                      className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md hover:bg-app-card hover:shadow-sm transition-all text-app-ink/70 hover:text-app-ink"
                    >
                      None
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Clear Selection</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleRevertSelection}
                      disabled={
                        filteredChannels.filter((c) => !c.isFrozen).length === 0
                      }
                      className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md hover:bg-app-card hover:shadow-sm transition-all text-app-ink/70 hover:text-app-ink disabled:opacity-30 disabled:pointer-events-none"
                    >
                      Revert
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Revert Selection</p>
                  </TooltipContent>
                </Tooltip>
              </div>

              <div className="h-6 w-px bg-app-ink/10 mx-1" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleScrapeSelected}
                    disabled={
                      isOffline ||
                      scrapingChannels.size > 0 ||
                      summarizing ||
                      selectedChannels.size === 0
                    }
                    className="h-8 px-4 text-[10px] uppercase font-bold flex items-center gap-2 bg-app-ink/10 text-app-ink hover:bg-app-ink/20 transition-all rounded-lg disabled:opacity-30"
                  >
                    <RefreshCw
                      size={12}
                      className={
                        scrapingChannels.size > 0 ? "animate-spin" : ""
                      }
                    />
                    <span className="hidden sm:inline">Sync Selected</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Sync Selected Channels</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleScrapeAll}
                    disabled={
                      isOffline || scrapingChannels.size > 0 || summarizing
                    }
                    className="h-8 px-4 text-[10px] uppercase font-bold flex items-center gap-2 bg-app-ink text-app-bg hover:opacity-90 transition-all rounded-lg shadow-sm disabled:opacity-30"
                  >
                    <RefreshCw
                      size={12}
                      className={
                        scrapingChannels.size > 0 ? "animate-spin" : ""
                      }
                    />
                    <span className="hidden sm:inline">Sync All</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Sync All Channels</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Group & tag filter rows */}
        {channels.length > 0 && (
          <div className="flex flex-col gap-3 pt-4 border-t border-app-ink/5">
            <div className="flex flex-wrap gap-2">
              {sortedSettingGroups.map((group) => {
                const channelsInGroup = channels.filter(
                  (channel) => channel.settingGroupId === group.id,
                )
                const channelsWithGroup = channelsInGroup.map(
                  (channel) => channel.name,
                )
                const selectedCount = channelsWithGroup.filter((name) =>
                  selectedChannels.has(name),
                ).length
                const isAllSelected =
                  selectedCount === channelsWithGroup.length &&
                  channelsWithGroup.length > 0
                const isPartial =
                  selectedCount > 0 && selectedCount < channelsWithGroup.length
                const isActiveFilter = selectedGroupFilter === group.id

                return (
                  <button
                    type="button"
                    key={group.id}
                    data-testid={`channel-group-${group.id}`}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey) {
                        setChannelGroupFilter(
                          selectedGroupFilter === group.id ? "" : group.id,
                        )
                        return
                      }
                      toggleGroupSelection(group.id)
                    }}
                    className={`text-[9px] font-bold px-2 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                      isActiveFilter ? "ring-2 ring-indigo-500/40" : ""
                    } ${
                      isAllSelected
                        ? "bg-app-ink text-app-bg"
                        : isPartial
                          ? "bg-app-ink/20 text-app-ink"
                          : "bg-app-muted/50 text-app-ink/60 hover:bg-app-ink/10 hover:text-app-ink"
                    }`}
                  >
                    <Layers size={10} />
                    {group.name}
                    <span className="opacity-60 text-[8px]">
                      ({selectedCount}/{channelsWithGroup.length})
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => {
                  const channelsWithTag = channels
                    .filter((c) => getTagNames(c.tags).includes(tag))
                    .map((c) => c.name)
                  const selectedCount = channelsWithTag.filter((name) =>
                    selectedChannels.has(name),
                  ).length
                  const isAllSelected =
                    selectedCount === channelsWithTag.length &&
                    channelsWithTag.length > 0
                  const isPartial =
                    selectedCount > 0 && selectedCount < channelsWithTag.length

                  return (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => toggleTagSelection(tag)}
                      className={`text-[9px] font-bold px-2 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                        isAllSelected
                          ? "bg-app-ink text-app-bg"
                          : isPartial
                            ? "bg-app-ink/20 text-app-ink"
                            : "bg-app-muted/50 text-app-ink/60 hover:bg-app-ink/10 hover:text-app-ink"
                      }`}
                    >
                      <Tag size={10} />
                      {tag}
                      <span className="opacity-60 text-[8px]">
                        ({selectedCount}/{channelsWithTag.length})
                      </span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  key={UNTAGGED_TAG_ID}
                  data-testid="channel-tag-untagged"
                  onClick={() => toggleTagSelection(UNTAGGED_TAG_ID)}
                  className={`text-[9px] font-bold px-2 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                    isUntaggedTagAllSelected
                      ? "bg-app-ink text-app-bg"
                      : isUntaggedTagPartial
                        ? "bg-app-ink/20 text-app-ink"
                        : "bg-app-muted/50 text-app-ink/60 hover:bg-app-ink/10 hover:text-app-ink"
                  }`}
                >
                  <Tag size={10} />
                  {UNTAGGED_TAG_LABEL}
                  <span className="opacity-60 text-[8px]">
                    ({untaggedTagSelectedCount}/{untaggedChannelNames.length})
                  </span>
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-app-ink/5 bg-app-muted/30 px-3 py-1.5">
                  <span className="text-[9px] uppercase font-bold text-app-ink/50">
                    AI Prompt Context
                  </span>
                  <label className="flex items-center gap-1.5 text-[10px] font-semibold text-app-ink/70">
                    <input
                      type="checkbox"
                      checked={includeChannelBioInPrompt}
                      onChange={(event) =>
                        setIncludeChannelBioInPrompt(event.target.checked)
                      }
                      className="h-3 w-3 accent-app-ink"
                    />
                    Include channel bio in prompts
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] font-semibold text-app-ink/70">
                    <input
                      type="checkbox"
                      checked={includeChannelTagsInPrompt}
                      onChange={(event) =>
                        setIncludeChannelTagsInPrompt(event.target.checked)
                      }
                      className="h-3 w-3 accent-app-ink"
                    />
                    Include current tags in prompts
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-app-ink/5 bg-app-muted/30 px-3 py-1.5">
                  {isFilteringActive && (
                    <>
                      <span className="text-[9px] uppercase font-bold text-app-ink/60">
                        Showing {filteredChannels.length} of {channels.length}{" "}
                        channels
                      </span>
                      <div className="h-4 w-px bg-app-ink/10" />
                    </>
                  )}
                  {allLanguages.length > 0 && (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] uppercase font-bold text-app-ink/50">
                          Lang
                        </span>
                        <Select
                          value={selectedLanguageFilter || "__all_languages__"}
                          onValueChange={(value) =>
                            setSelectedLanguageFilter(
                              value === "__all_languages__" ? "" : value,
                            )
                          }
                        >
                          <SelectTrigger className={selectTriggerClassName}>
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent className="border-app-ink/15 bg-app-card text-app-ink">
                            <SelectItem value="__all_languages__">
                              All
                            </SelectItem>
                            {allLanguages.map((lang) => (
                              <SelectItem key={lang} value={lang}>
                                {lang}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="h-4 w-px bg-app-ink/10" />
                    </>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase font-bold text-app-ink/50">
                      Sort By
                    </span>
                    <Select
                      value={sortBy}
                      onValueChange={(value) =>
                        setSortBy(value as ChannelGridSortOption)
                      }
                    >
                      <SelectTrigger className={selectTriggerClassName}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-app-ink/15 bg-app-card text-app-ink">
                        <SelectItem value="last_updated">
                          Last Updated
                        </SelectItem>
                        <SelectItem value="followed_at">Followed At</SelectItem>
                        <SelectItem value="activity_rate">
                          Activity Rate
                        </SelectItem>
                        <SelectItem value="total_posts">Total Posts</SelectItem>
                        <SelectItem value="channel_id">Channel ID</SelectItem>
                        <SelectItem value="channel_name">
                          Channel Name
                        </SelectItem>
                        <SelectItem value="next_regular_sync">
                          Next Regular Sync
                        </SelectItem>
                        <SelectItem value="next_dynamic_sync">
                          Next Dynamic Sync
                        </SelectItem>
                        <SelectItem value="next_auto_sync">
                          Next Auto Sync
                        </SelectItem>
                        {showChannelSubscribers && (
                          <SelectItem value="subscribers">
                            Subscribers
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() =>
                        setSortDirection((prev) =>
                          prev === "asc" ? "desc" : "asc",
                        )
                      }
                      className="p-1 hover:bg-app-ink/10 rounded-md transition-colors text-app-ink/70 hover:text-app-ink"
                      title={`Sort ${sortDirection === "asc" ? "Ascending" : "Descending"}`}
                    >
                      {sortDirection === "asc" ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      )}
                    </button>
                  </div>
                  <div className="h-4 w-px bg-app-ink/10" />
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={trimCount}
                      onChange={(event) => setTrimCount(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleTrimSelection()
                      }}
                      disabled={selectedChannels.size === 0}
                      data-testid="channel-trim-count"
                      className="w-14 bg-app-muted/50 border border-app-ink/10 rounded-md py-1 px-2 text-[10px] focus:outline-none focus:ring-1 focus:ring-app-ink/20 transition-all disabled:opacity-30"
                      aria-label="Trim selection count"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={handleTrimSelection}
                          disabled={isTrimDisabled}
                          data-testid="channel-trim-button"
                          className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-app-ink/10 text-app-ink hover:bg-app-ink/20 transition-all disabled:opacity-30 disabled:pointer-events-none"
                        >
                          Trim
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          Keep the first N selected channels by current sort
                          order. Only shrinks selection.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Actions */}
        {selectedChannels.size > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-app-ink/5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase font-bold text-app-ink/70">
                {selectedChannels.size} Selected
              </span>
              <div className="h-4 w-px bg-app-ink/10 mx-1" />
              <button
                type="button"
                onClick={() => setConfirmBulkFreezeAction("freeze")}
                className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-all"
              >
                Freeze
              </button>
              <button
                type="button"
                onClick={() => setConfirmBulkFreezeAction("unfreeze")}
                className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-app-muted/50 text-app-ink/70 hover:bg-app-ink/10 transition-all"
              >
                Unfreeze
              </button>
              <div className="h-4 w-px bg-app-ink/10 mx-1" />
              <div className="flex items-center gap-2 rounded-md border border-app-ink/10 bg-app-muted/40 px-2 py-1.5">
                <span className="text-[9px] uppercase font-bold text-app-ink/60">
                  Move to group
                </span>
                <Select
                  value={bulkTargetGroupId}
                  onValueChange={setBulkTargetGroupId}
                >
                  <SelectTrigger className={selectTriggerClassName}>
                    <SelectValue placeholder="Group" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedSettingGroups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                        {group.isDefault ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => void applyBulkMoveToGroup()}
                  className="px-2 py-1 text-[9px] uppercase font-bold rounded bg-app-ink text-app-bg"
                >
                  Apply
                </button>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={bulkTagInput}
                  onChange={(e) => setBulkTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleBulkAddTag()}
                  placeholder="Add tag..."
                  className="w-32 bg-app-muted/50 border border-app-ink/10 rounded-md py-1.5 pl-2 pr-10 text-[10px] focus:outline-none focus:ring-1 focus:ring-app-ink/20 transition-all"
                />
                <button
                  type="button"
                  onClick={handleBulkAddTag}
                  disabled={!bulkTagInput.trim()}
                  className="absolute inset-y-1 right-1 px-2 bg-app-ink text-app-bg text-[8px] uppercase font-bold rounded hover:opacity-90 transition-opacity disabled:opacity-30"
                >
                  Add
                </button>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={bulkRemoveTagInput}
                  onChange={(e) => setBulkRemoveTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleBulkRemoveTag()}
                  placeholder="Remove tag..."
                  className="w-32 bg-app-muted/50 border border-app-ink/10 rounded-md py-1.5 pl-2 pr-14 text-[10px] focus:outline-none focus:ring-1 focus:ring-app-ink/20 transition-all"
                />
                <button
                  type="button"
                  onClick={handleBulkRemoveTag}
                  disabled={!bulkRemoveTagInput.trim()}
                  className="absolute inset-y-1 right-1 px-2 bg-app-ink text-app-bg text-[8px] uppercase font-bold rounded hover:opacity-90 transition-opacity disabled:opacity-30"
                >
                  Remove
                </button>
              </div>
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(true)}
                className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {isInitialChannelsLoading ? (
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          id="tour-channel-grid"
        >
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={`channel-skeleton-${index}`}
              className="rounded-2xl border border-app-ink/10 bg-app-card p-5"
            >
              <div className="mb-4 flex items-start gap-4">
                <Skeleton className="h-14 w-14 rounded-full bg-app-ink/10" />
                <div className="flex-1 space-y-2 pt-1">
                  <Skeleton className="h-4 w-3/4 bg-app-ink/10" />
                  <Skeleton className="h-3 w-1/2 bg-app-ink/10" />
                </div>
              </div>
              <div className="mb-5 flex flex-wrap gap-2">
                <Skeleton className="h-6 w-24 bg-app-ink/10" />
                <Skeleton className="h-6 w-20 bg-app-ink/10" />
                <Skeleton className="h-6 w-28 bg-app-ink/10" />
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-app-ink/5 pt-4">
                <Skeleton className="h-8 w-28 bg-app-ink/10" />
                <Skeleton className="h-8 w-20 bg-app-ink/10" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredChannels.length === 0 ? (
        <div
          id="tour-channel-grid"
          className="flex flex-col items-center justify-center py-20 px-4 text-center border border-dashed border-app-ink/20 rounded-2xl bg-app-muted/5"
        >
          <div className="w-20 h-20 bg-app-ink/5 rounded-full flex items-center justify-center mb-6 border border-app-ink/10">
            <Send size={32} className="opacity-20" />
          </div>
          <h3 className="text-xl font-bold mb-2 text-app-ink">
            No Channels Found
          </h3>
          <p className="text-sm opacity-60 max-w-md mx-auto mb-8">
            {channels.length === 0
              ? "Start by adding a Telegram channel username above. We'll fetch its details and you can begin syncing posts immediately."
              : "No channels match your search."}
          </p>
        </div>
      ) : (
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          id="tour-channel-grid"
        >
          {sortedFilteredChannels.slice(0, visibleChannels).map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              handleRemoveChannel={handleRemoveChannel}
              handleResetAndSync={handleResetAndSync}
            />
          ))}

          {hasMoreChannels && (
            <div
              ref={loadMoreSentinelRef}
              data-testid="channel-grid-load-more"
              className="col-span-full h-10 w-full"
            />
          )}
        </div>
      )}

      <Dialog
        open={confirmResetModal !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmResetModal(null)
        }}
      >
        <DialogContent className="border-app-ink/20 bg-app-card p-0 text-app-ink sm:max-w-md">
          <DialogHeader className="border-b border-app-ink/10 p-4">
            <DialogTitle className="text-lg font-bold tracking-tight">
              Reset & Sync Channel
            </DialogTitle>
            <DialogDescription className="text-sm text-app-ink/70">
              {confirmResetModal
                ? `Clear all posts for @${confirmResetModal.name} and re-sync from ID ${confirmResetModal.startId ?? 1}?`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-t border-app-ink/10 bg-app-muted/30 p-4 sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirmResetModal(null)}
              className="px-4 py-2 border border-app-ink/20 hover:bg-app-ink/5 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={executeResetAndSync}
              className="px-4 py-2 bg-red-500 text-white hover:bg-red-600 transition-colors text-sm font-medium"
            >
              Confirm
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDeleteChannel !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmDeleteChannel(null)
        }}
      >
        <DialogContent className="border-app-ink/20 bg-app-card p-0 text-app-ink sm:max-w-md">
          <DialogHeader className="border-b border-app-ink/10 p-4">
            <DialogTitle className="text-lg font-bold tracking-tight">
              Remove Channel?
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-app-ink/60">
              {confirmDeleteChannel ? (
                <>
                  You are about to remove{" "}
                  <span className="font-bold text-app-ink">
                    @{confirmDeleteChannel.name}
                  </span>
                  . This will also permanently delete all scraped posts
                  associated with this channel from your local database.
                </>
              ) : (
                ""
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="px-4 pt-4">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <ShieldAlert className="text-red-500" size={20} />
            </div>
          </div>
          <DialogFooter className="border-t border-app-ink/10 bg-app-muted/30 p-4">
            <button
              type="button"
              onClick={() => setConfirmDeleteChannel(null)}
              className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-app-ink/10 hover:bg-app-muted/50 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={executeDeleteChannel}
              className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
            >
              Delete Everything
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmBulkDelete}
        onOpenChange={(nextOpen) => setConfirmBulkDelete(nextOpen)}
      >
        <DialogContent className="border-app-ink/20 bg-app-card p-0 text-app-ink sm:max-w-md">
          <DialogHeader className="border-b border-app-ink/10 p-4">
            <DialogTitle className="text-lg font-bold tracking-tight">
              Remove Selected Channels?
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-app-ink/60">
              You are about to remove{" "}
              <span className="font-bold text-app-ink">
                {selectedChannels.size} selected channels
              </span>
              . This will also permanently delete all scraped posts associated
              with these channels from your local database.
            </DialogDescription>
          </DialogHeader>
          <div className="px-4 pt-4">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <ShieldAlert className="text-red-500" size={20} />
            </div>
          </div>
          <DialogFooter className="border-t border-app-ink/10 bg-app-muted/30 p-4">
            <button
              type="button"
              onClick={() => setConfirmBulkDelete(false)}
              className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-app-ink/10 hover:bg-app-muted/50 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={executeBulkDelete}
              className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
            >
              Delete {selectedChannels.size} Channels
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmBulkFreezeAction !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmBulkFreezeAction(null)
        }}
      >
        <DialogContent className="border-app-ink/20 bg-app-card p-0 text-app-ink sm:max-w-md">
          <DialogHeader className="border-b border-app-ink/10 p-4">
            <DialogTitle className="text-lg font-bold tracking-tight">
              {confirmBulkFreezeAction === "freeze"
                ? "Freeze Selected Channels?"
                : "Unfreeze Selected Channels?"}
            </DialogTitle>
            <DialogDescription className="text-sm text-app-ink/70">
              {confirmBulkFreezeAction === "freeze"
                ? "Freeze all currently selected channels. They will be skipped during sync."
                : "Unfreeze all currently selected channels."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-t border-app-ink/10 bg-app-muted/30 p-4">
            <button
              type="button"
              onClick={() => setConfirmBulkFreezeAction(null)}
              className="rounded-md border border-app-ink/20 px-3 py-2 text-xs font-mono uppercase tracking-widest hover:bg-app-ink/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmBulkFreezeAction}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-mono uppercase tracking-widest text-red-600 hover:bg-red-500/20"
            >
              Confirm
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
