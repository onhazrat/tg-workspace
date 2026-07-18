import { RefreshCw } from "lucide-react"
import type React from "react"
import { TgButton } from "@/components/ui/tg-button"
import { TgInput } from "@/components/ui/tg-input"
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
          <TgInput
            type="text"
            variant="muted"
            value={inlineChannelName}
            onChange={(e) => onInlineChannelNameChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddChannel()}
            placeholder="telegram_channel"
            className="pl-8 pr-20"
          />
          <TgButton
            type="button"
            variant="primary"
            size="sm"
            onClick={onAddChannel}
            disabled={!inlineChannelName.trim()}
            className="absolute inset-y-1 right-1"
          >
            Add
          </TgButton>
        </div>
        {/* Search Channels Input */}
        <div className="relative flex-1">
          <TgInput
            type="text"
            variant="muted"
            value={channelSearch}
            onChange={(e) => onChannelSearchChange(e.target.value)}
            placeholder="Search channels..."
          />
        </div>
        {/* Search Tags Input */}
        <div className="relative flex-1">
          <TgInput
            type="text"
            variant="muted"
            value={tagSearch}
            onChange={(e) => onTagSearchChange(e.target.value)}
            placeholder="Search tags..."
            data-testid="channel-tag-search"
          />
        </div>
      </div>

      {/* Action Grouping */}
      {hasChannels && (
        <div className="flex items-center gap-2">
          <div className="flex bg-app-muted/50 p-1 rounded-lg border border-app-ink/5">
            <Tooltip>
              <TooltipTrigger asChild>
                <TgButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onSelectAll}
                >
                  All
                </TgButton>
              </TooltipTrigger>
              <TooltipContent>
                <p>Select All</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TgButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onUnselectAll}
                >
                  None
                </TgButton>
              </TooltipTrigger>
              <TooltipContent>
                <p>Clear Selection</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TgButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRevertSelection}
                  disabled={isRevertDisabled}
                >
                  Revert
                </TgButton>
              </TooltipTrigger>
              <TooltipContent>
                <p>Revert Selection</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="h-6 w-px bg-app-ink/10 mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <TgButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={onScrapeSelected}
                disabled={isScrapeSelectedDisabled}
                loading={isScraping}
                className="bg-app-ink/10 text-app-ink hover:bg-app-ink/20 hover:text-app-ink"
              >
                <RefreshCw size={12} />
                <span className="hidden sm:inline">Sync Selected</span>
              </TgButton>
            </TooltipTrigger>
            <TooltipContent>
              <p>Sync Selected Channels</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <TgButton
                type="button"
                variant="primary"
                size="sm"
                onClick={onScrapeAll}
                disabled={isScrapeAllDisabled}
                loading={isScraping}
              >
                <RefreshCw size={12} />
                <span className="hidden sm:inline">Sync All</span>
              </TgButton>
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
