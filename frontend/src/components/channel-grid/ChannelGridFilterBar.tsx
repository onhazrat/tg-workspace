import { ArrowDown, ArrowUp } from "lucide-react"
import type React from "react"
import {
  controlGroupItemClassName,
  controlGroupLabelClassName,
  controlSeparatorClassName,
  controlWrapGroupClassName,
} from "@/components/channel-grid/control-styles"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { TgInput } from "@/components/ui/tg-input"
import { selectTriggerClassName } from "@/components/ui/tg-select-trigger"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import type { ChannelGridSortOption } from "@/lib/channels/sort-channels-for-grid"

type ChannelGridFilterBarProps = {
  includeChannelBioInPrompt: boolean
  onIncludeChannelBioInPromptChange: (value: boolean) => void
  includeChannelTagsInPrompt: boolean
  onIncludeChannelTagsInPromptChange: (value: boolean) => void
  isFilteringActive: boolean
  filteredCount: number
  totalCount: number
  allLanguages: string[]
  selectedLanguageFilter: string
  onLanguageFilterChange: (value: string) => void
  sortBy: ChannelGridSortOption
  onSortByChange: (value: ChannelGridSortOption) => void
  sortDirection: "asc" | "desc"
  onToggleSortDirection: () => void
  showChannelSubscribers: boolean
  trimCount: string
  onTrimCountChange: (value: string) => void
  isTrimInputDisabled: boolean
  isTrimDisabled: boolean
  onTrimSelection: () => void
  showSortRank: boolean
  onShowSortRankChange: (value: boolean) => void
}

/** AI prompt-context toggles plus language filter, sort controls, trim, and sort-rank toggle. */
export const ChannelGridFilterBar: React.FC<ChannelGridFilterBarProps> = ({
  includeChannelBioInPrompt,
  onIncludeChannelBioInPromptChange,
  includeChannelTagsInPrompt,
  onIncludeChannelTagsInPromptChange,
  isFilteringActive,
  filteredCount,
  totalCount,
  allLanguages,
  selectedLanguageFilter,
  onLanguageFilterChange,
  sortBy,
  onSortByChange,
  sortDirection,
  onToggleSortDirection,
  showChannelSubscribers,
  trimCount,
  onTrimCountChange,
  isTrimInputDisabled,
  isTrimDisabled,
  onTrimSelection,
  showSortRank,
  onShowSortRankChange,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className={controlWrapGroupClassName}>
        <span className={controlGroupLabelClassName}>AI Prompt Context</span>
        <label className="flex items-center gap-1.5 text-[10px] font-semibold text-app-ink/70">
          <input
            type="checkbox"
            checked={includeChannelBioInPrompt}
            onChange={(event) =>
              onIncludeChannelBioInPromptChange(event.target.checked)
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
              onIncludeChannelTagsInPromptChange(event.target.checked)
            }
            className="h-3 w-3 accent-app-ink"
          />
          Include current tags in prompts
        </label>
      </div>

      <div className={controlWrapGroupClassName}>
        {isFilteringActive && (
          <>
            <span className={controlGroupLabelClassName}>
              Showing {filteredCount} of {totalCount} channels
            </span>
            <div className={controlSeparatorClassName} />
          </>
        )}
        {allLanguages.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <span className={controlGroupLabelClassName}>Lang</span>
              <Select
                value={selectedLanguageFilter || "__all_languages__"}
                onValueChange={(value) =>
                  onLanguageFilterChange(
                    value === "__all_languages__" ? "" : value,
                  )
                }
              >
                <SelectTrigger size="sm" className={selectTriggerClassName}>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent className="border-app-ink/15 bg-app-card text-app-ink">
                  <SelectItem value="__all_languages__">All</SelectItem>
                  {allLanguages.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {lang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className={controlSeparatorClassName} />
          </>
        )}
        <div className="flex items-center gap-2">
          <span className={controlGroupLabelClassName}>Sort By</span>
          <Select
            value={sortBy}
            onValueChange={(value) =>
              onSortByChange(value as ChannelGridSortOption)
            }
          >
            <SelectTrigger size="sm" className={selectTriggerClassName}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-app-ink/15 bg-app-card text-app-ink">
              <SelectItem value="last_updated">Last Updated</SelectItem>
              <SelectItem value="followed_at">Followed At</SelectItem>
              <SelectItem value="activity_rate">Activity Rate</SelectItem>
              <SelectItem value="total_posts">Total Posts</SelectItem>
              <SelectItem value="posts_in_scope">Posts in Scope</SelectItem>
              <SelectItem value="channel_id">Channel ID</SelectItem>
              <SelectItem value="channel_name">Channel Name</SelectItem>
              <SelectItem value="next_regular_sync">
                Next Regular Sync
              </SelectItem>
              <SelectItem value="next_dynamic_sync">
                Next Dynamic Sync
              </SelectItem>
              <SelectItem value="next_auto_sync">Next Auto Sync</SelectItem>
              {showChannelSubscribers && (
                <SelectItem value="subscribers">Subscribers</SelectItem>
              )}
            </SelectContent>
          </Select>
          <TgIconButton
            variant="ghost"
            aria-label={`Sort ${sortDirection === "asc" ? "Ascending" : "Descending"}`}
            tooltip={`Sort ${sortDirection === "asc" ? "Ascending" : "Descending"}`}
            onClick={onToggleSortDirection}
            className={`${controlGroupItemClassName} w-7 p-0 text-app-ink/70 hover:bg-app-ink/10 hover:text-app-ink`}
          >
            {sortDirection === "asc" ? (
              <ArrowUp size={12} />
            ) : (
              <ArrowDown size={12} />
            )}
          </TgIconButton>
        </div>
        <div className={controlSeparatorClassName} />
        <div className="flex items-center gap-2">
          <TgInput
            type="number"
            variant="muted"
            min={1}
            value={trimCount}
            onChange={(event) => onTrimCountChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onTrimSelection()
            }}
            disabled={isTrimInputDisabled}
            data-testid="channel-trim-count"
            className={`${controlGroupItemClassName} w-14 rounded-md border-app-ink/15 bg-app-card/70 px-2 py-0 text-[10px] focus:ring-1`}
            aria-label="Trim selection count"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <TgButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={onTrimSelection}
                disabled={isTrimDisabled}
                data-testid="channel-trim-button"
                className={`${controlGroupItemClassName} bg-app-ink/10 px-2.5 text-app-ink hover:bg-app-ink/20 hover:text-app-ink`}
              >
                Trim
              </TgButton>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                Keep the first N selected channels by current sort order. Only
                shrinks selection.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className={controlSeparatorClassName} />
        <label className="flex items-center gap-1.5 text-[10px] font-semibold text-app-ink/70">
          <input
            type="checkbox"
            checked={showSortRank}
            onChange={(event) => onShowSortRankChange(event.target.checked)}
            data-testid="channel-show-sort-rank"
            className="h-3 w-3 accent-app-ink"
          />
          Show sort rank
        </label>
      </div>
    </div>
  )
}
