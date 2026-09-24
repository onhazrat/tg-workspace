import {
  Activity,
  Check,
  Clock,
  Loader2,
  RotateCcw,
  Snowflake,
  Trash2,
} from "lucide-react"
import { motion } from "motion/react"
import { channelAllows, disabledReason } from "@/lib/channels/sync-permissions"
import { languageName } from "@/lib/language-name"
import type { Channel } from "@/types"
import { TgIconButton } from "../ui/tg-icon-button"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tg-tooltip"

/** Covers the card while it syncs; `progress` is null when the channel's newest id is unknown. */
export function ChannelCardSyncingOverlay({
  progress,
}: {
  progress: number | null
}) {
  return (
    <div className="absolute inset-0 bg-app-bg/60 backdrop-blur-[2px] flex items-center justify-center z-30">
      <div className="flex flex-col items-center gap-3 w-full px-8">
        <div className="relative">
          <Loader2 size={32} className="animate-spin text-app-ink opacity-80" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-app-ink rounded-full animate-pulse" />
          </div>
        </div>
        <div className="flex flex-col items-center gap-1.5 w-full">
          <span className="text-[10px] uppercase font-bold tracking-widest text-app-ink bg-app-bg/80 px-3 py-1 rounded-full shadow-sm">
            {progress === null
              ? "Syncing Data"
              : `Syncing ${Math.round(progress)}%`}
          </span>
          {progress !== null && (
            <div className="w-full max-w-[120px] h-1 bg-app-ink/10 rounded-full overflow-hidden mt-1">
              <motion.div
                className="h-full bg-app-ink"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Hover action bar: freeze, reset and remove. */
export function ChannelCardActions({
  channel,
  busy,
  onToggleFreeze,
  onResetAndSync,
  onRemove,
}: {
  channel: Channel
  /** A sync or summary is running, so reset must wait. */
  busy: boolean
  onToggleFreeze: () => void
  onResetAndSync: () => void
  onRemove: () => void
}) {
  const freezeLabel = channel.isFrozen
    ? "Unfreeze Channel"
    : "Freeze Channel (Stop Syncing)"
  const resetLabel =
    disabledReason(channel, "reset") ?? "Reset & Sync from beginning"
  return (
    <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-20">
      {!channel.isUnavailableOnWebView && (
        <TgIconButton
          variant="frosted"
          aria-label={freezeLabel}
          tooltip={freezeLabel}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFreeze()
          }}
          className={
            channel.isFrozen
              ? "text-blue-500 hover:bg-blue-500 hover:text-white"
              : undefined
          }
        >
          <Snowflake size={14} />
        </TgIconButton>
      )}
      <TgIconButton
        variant="frosted"
        aria-label={resetLabel}
        tooltip={resetLabel}
        onClick={(e) => {
          e.stopPropagation()
          onResetAndSync()
        }}
        disabled={busy || !channelAllows(channel, "reset")}
      >
        <RotateCcw size={14} />
      </TgIconButton>
      <TgIconButton
        variant="frosted"
        aria-label="Remove Channel"
        tooltip="Remove Channel"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="text-red-500/70 hover:bg-red-500 hover:text-white"
      >
        <Trash2 size={14} />
      </TgIconButton>
    </div>
  )
}

/** Selection toggle plus the queue, rank, availability, language and history badges. */
export function ChannelCardBadges({
  channel,
  isSelected,
  onToggleSelected,
  queuePosition,
  sortRank,
}: {
  channel: Channel
  isSelected: boolean
  onToggleSelected: () => void
  /** 1-based place in the sync queue, or null when not queued. */
  queuePosition: number | null
  sortRank?: number
}) {
  return (
    <div className="absolute top-4 left-4 flex items-center gap-2 z-20">
      <button
        type="button"
        onClick={onToggleSelected}
        aria-label={
          isSelected ? `Deselect ${channel.name}` : `Select ${channel.name}`
        }
        aria-pressed={isSelected}
        className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30 ${
          isSelected
            ? "bg-app-ink border-app-ink text-app-bg"
            : "border-app-ink/20 bg-app-bg/50 text-transparent hover:border-app-ink/40"
        }`}
      >
        <Check size={12} strokeWidth={3} />
      </button>

      {queuePosition !== null && (
        <div className="bg-app-ink text-app-bg text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
          <Clock size={10} />
          <span>#{queuePosition}</span>
        </div>
      )}

      {sortRank != null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              data-testid="channel-sort-rank"
              className="bg-app-ink/5 text-app-ink/60 border border-app-ink/10 text-[9px] font-bold px-1.5 py-0.5 rounded-full tabular-nums shadow-sm cursor-help"
            >
              #{sortRank}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              Rank {sortRank} among selected channels by current sort order
              (Trim keeps ranks 1–N)
            </p>
          </TooltipContent>
        </Tooltip>
      )}

      {channel.isUnavailableOnWebView && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="bg-red-500/10 text-red-500 border border-red-500/20 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm cursor-help">
              <Activity size={10} />
              <span>Unavailable</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              This channel is not available on the web view and cannot be
              scraped.
            </p>
          </TooltipContent>
        </Tooltip>
      )}

      {channel.language && (
        <div className="bg-app-ink/5 text-app-ink/70 border border-app-ink/10 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
          <span>{languageName(channel.language)}</span>
        </div>
      )}

      {channel.historyCompleteToCutoff === false && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="bg-amber-500/10 text-amber-700 border border-amber-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm cursor-help">
              <Clock size={10} />
              <span>Partial history</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>History does not reach retention window</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
