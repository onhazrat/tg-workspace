import { RefreshCw } from "lucide-react"
import type React from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"

type ChannelGridToolbarProps = {
  inlineChannelName: string
  onInlineChannelNameChange: (value: string) => void
  onAddChannel: () => void
  channelSearch: string
  onChannelSearchChange: (value: string) => void
  tagSearch: string
  onTagSearchChange: (value: string) => void
  hasChannels: boolean
  onSelectAll: () => void
  onUnselectAll: () => void
  onRevertSelection: () => void
  isRevertDisabled: boolean
  isScraping: boolean
  isScrapeSelectedDisabled: boolean
  isScrapeAllDisabled: boolean
  onScrapeSelected: () => void
  onScrapeAll: () => void
}

/** Top control row: add-channel input, channel/tag search, selection shortcuts, sync buttons. */
export const ChannelGridToolbar: React.FC<ChannelGridToolbarProps> = ({
  inlineChannelName,
  onInlineChannelNameChange,
  onAddChannel,
  channelSearch,
  onChannelSearchChange,
  tagSearch,
  onTagSearchChange,
  hasChannels,
  onSelectAll,
  onUnselectAll,
  onRevertSelection,
  isRevertDisabled,
  isScraping,
  isScrapeSelectedDisabled,
  isScrapeAllDisabled,
  onScrapeSelected,
  onScrapeAll,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex flex-col sm:flex-row flex-1 gap-2 max-w-3xl">
        {/* Modern Input */}
        <div className="relative flex-1" id="tour-add-channel">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <span className="text-app-ink/40 font-bold">@</span>
          </div>
          <input
            type="text"
            value={inlineChannelName}
            onChange={(e) => onInlineChannelNameChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddChannel()}
            placeholder="telegram_channel"
            className="w-full bg-app-muted/50 border border-app-ink/10 rounded-lg py-2 pl-8 pr-20 text-sm focus:outline-none focus:ring-2 focus:ring-app-ink/20 transition-all"
          />
          <button
            type="button"
            onClick={onAddChannel}
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
            onChange={(e) => onChannelSearchChange(e.target.value)}
            placeholder="Search channels..."
            className="w-full bg-app-muted/50 border border-app-ink/10 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-app-ink/20 transition-all"
          />
        </div>
        {/* Search Tags Input */}
        <div className="relative flex-1">
          <input
            type="text"
            value={tagSearch}
            onChange={(e) => onTagSearchChange(e.target.value)}
            placeholder="Search tags..."
            data-testid="channel-tag-search"
            className="w-full bg-app-muted/50 border border-app-ink/10 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-app-ink/20 transition-all"
          />
        </div>
      </div>

      {/* Action Grouping */}
      {hasChannels && (
        <div className="flex items-center gap-2">
          <div className="flex bg-app-muted/50 p-1 rounded-lg border border-app-ink/5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onSelectAll}
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
                  onClick={onUnselectAll}
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
                  onClick={onRevertSelection}
                  disabled={isRevertDisabled}
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
                onClick={onScrapeSelected}
                disabled={isScrapeSelectedDisabled}
                className="h-8 px-4 text-[10px] uppercase font-bold flex items-center gap-2 bg-app-ink/10 text-app-ink hover:bg-app-ink/20 transition-all rounded-lg disabled:opacity-30"
              >
                <RefreshCw
                  size={12}
                  className={isScraping ? "animate-spin" : ""}
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
                onClick={onScrapeAll}
                disabled={isScrapeAllDisabled}
                className="h-8 px-4 text-[10px] uppercase font-bold flex items-center gap-2 bg-app-ink text-app-bg hover:opacity-90 transition-all rounded-lg shadow-sm disabled:opacity-30"
              >
                <RefreshCw
                  size={12}
                  className={isScraping ? "animate-spin" : ""}
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
  )
}
