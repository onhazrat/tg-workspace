/**
 * PROTOTYPE, throwaway. Three redesigns of the Channels tab control section,
 * switchable with `?variant=A|B|C` on `/workspace?tab=channels`. No variant is
 * production code; the winner gets rewritten properly.
 *
 * Every capability of the current bar travels in this one props bag, so a
 * variant that forgets one is visibly missing a field rather than silently
 * dropping it.
 */

import type { CardZoom } from "@/lib/channels/card-zoom"
import { getChipSelectionState } from "@/lib/channels/channel-grid-chips"
import type { ChannelPseudoTagChip } from "@/lib/channels/channel-tags"
import type { ChannelLanguageOption } from "@/lib/channels/filter-channels-for-grid"
import type { ChannelGridSortOption } from "@/lib/channels/sort-channels-for-grid"
import type { Channel, ChannelSettingGroup } from "@/types"

export type ChannelControlsProps = {
  // Follow a channel
  inlineChannelName: string
  onInlineChannelNameChange: (value: string) => void
  onAddChannel: () => void
  // Search
  channelSearch: string
  onChannelSearchChange: (value: string) => void
  tagSearch: string
  onTagSearchChange: (value: string) => void
  // Counts
  channels: Channel[]
  hasChannels: boolean
  totalCount: number
  filteredCount: number
  isFilteringActive: boolean
  selectedChannels: Set<string>
  // Selection shortcuts
  onSelectAll: () => void
  onUnselectAll: () => void
  onRevertSelection: () => void
  isRevertDisabled: boolean
  // Sync
  isScraping: boolean
  isScrapeSelectedDisabled: boolean
  isScrapeAllDisabled: boolean
  onScrapeSelected: () => void
  onScrapeAll: () => void
  // Card zoom
  zoom: CardZoom
  onZoomChange: (zoom: CardZoom) => void
  // Setting groups: click selects, the filter narrows the grid
  groups: ChannelSettingGroup[]
  /** Funnelled groups; a channel in any of them shows. Empty shows all. */
  groupFilters: string[]
  onGroupFiltersChange: (ids: string[]) => void
  onToggleGroupSelection: (groupId: string) => void
  // Tags and pseudo-tags
  visibleTags: string[]
  pseudoTagChips: ChannelPseudoTagChip[]
  onToggleTag: (tag: string) => void
  /** Funnelled tags (and pseudo-tags); a channel with any of them shows. */
  tagFilters: string[]
  onTagFiltersChange: (tags: string[]) => void
  // AI prompt context
  includeChannelBioInPrompt: boolean
  onIncludeChannelBioInPromptChange: (value: boolean) => void
  includeChannelTagsInPrompt: boolean
  onIncludeChannelTagsInPromptChange: (value: boolean) => void
  // Language, sort, grouping
  allLanguages: ChannelLanguageOption[]
  /** Funnelled language codes; a channel in any of them shows. */
  languageFilters: string[]
  onLanguageFiltersChange: (codes: string[]) => void
  /** PROTOTYPE-only: tick every channel in a language, like a group chip. */
  onToggleLanguageSelection: (code: string) => void
  sortBy: ChannelGridSortOption
  onSortByChange: (value: ChannelGridSortOption) => void
  sortDirection: "asc" | "desc"
  onToggleSortDirection: () => void
  groupBySelection: boolean
  onToggleGroupBySelection: () => void
  showChannelSubscribers: boolean
  // Trim and rank
  trimCount: string
  onTrimCountChange: (value: string) => void
  isTrimInputDisabled: boolean
  isTrimDisabled: boolean
  onTrimSelection: () => void
  showSortRank: boolean
  onShowSortRankChange: (value: boolean) => void
  // Bulk actions
  onRequestFreeze: () => void
  onRequestUnfreeze: () => void
  onRequestDelete: () => void
  bulkTargetGroupId: string
  onBulkTargetGroupIdChange: (value: string) => void
  onApplyMoveToGroup: () => void
  bulkTagInput: string
  onBulkTagInputChange: (value: string) => void
  onBulkAddTag: () => void
  bulkRemoveTagInput: string
  onBulkRemoveTagInputChange: (value: string) => void
  onBulkRemoveTag: () => void
}

export const SORT_OPTIONS: {
  value: ChannelGridSortOption
  label: string
  subscribersOnly?: boolean
}[] = [
  { value: "last_updated", label: "Last updated" },
  { value: "followed_at", label: "Followed at" },
  { value: "activity_rate", label: "Activity rate" },
  { value: "reach", label: "Reach" },
  { value: "total_posts", label: "Total posts" },
  { value: "posts_in_scope", label: "Posts in scope" },
  { value: "channel_id", label: "Channel ID" },
  { value: "channel_name", label: "Channel name" },
  { value: "next_regular_sync", label: "Next regular sync" },
  { value: "next_dynamic_sync", label: "Next dynamic sync" },
  { value: "next_auto_sync", label: "Next auto sync" },
  { value: "subscribers", label: "Subscribers", subscribersOnly: true },
]

export const sortOptionsFor = (showSubscribers: boolean) =>
  SORT_OPTIONS.filter((o) => showSubscribers || !o.subscribersOnly)

export const sortLabel = (value: ChannelGridSortOption) =>
  SORT_OPTIONS.find((o) => o.value === value)?.label ?? value

/** Selection state of a chip's channel set, in the chip component's vocabulary. */
export const chipSelection = (names: string[], selected: Set<string>) => {
  const { selectedCount, isAllSelected, isPartial } = getChipSelectionState(
    names,
    selected,
  )
  const state = isAllSelected ? "selected" : isPartial ? "partial" : "idle"
  return { state, selectedCount, total: names.length } as const
}
