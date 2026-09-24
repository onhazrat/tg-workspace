import { Edit2, RefreshCw } from "lucide-react"
import { useState } from "react"
import { channelAllows, disabledReason } from "@/lib/channels/sync-permissions"
import {
  syncScheduleDetail,
  syncScheduleSummary,
} from "@/lib/channels/sync-schedule-summary"
import type { Channel, ChannelStats } from "@/types"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tg-tooltip"
import { channelSyncStatus, parseStartId } from "./channel-card-status"

/** Config and sync row: Start ID, status, and the manual Sync button. */
export function ChannelCardFooter({
  channel,
  stats,
  showStartId,
  isScraping,
  busy,
  inheritedSettingsHint,
  onSaveStartId,
  onSync,
}: {
  channel: Channel
  stats: ChannelStats | undefined
  showStartId: boolean
  isScraping: boolean
  /** A sync or summary is running, so a manual sync must wait. */
  busy: boolean
  inheritedSettingsHint: string
  onSaveStartId: (startId: number) => void
  onSync: () => void
}) {
  const status = channelSyncStatus(channel, stats)
  return (
    <div className="mt-auto flex items-center justify-between pt-4 border-t border-app-ink/5 gap-3">
      <div className="flex items-start gap-4 flex-wrap">
        {showStartId && (
          <StartIdField startId={channel.startId} onSave={onSaveStartId} />
        )}

        <div>
          <p className="text-[10px] uppercase text-app-ink/60 font-bold tracking-widest mb-0.5">
            Status
          </p>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
            <p className="text-[10px] font-bold uppercase tracking-tight text-app-ink/70">
              {status.label}
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-[9px] text-app-ink/50 mt-1 max-w-[220px] truncate cursor-help">
                {syncScheduleSummary(channel)}
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px] text-center">
              {/* The card face shows relative times; the exact schedule only
                  fits here. It used to be missing entirely — this tooltip
                  showed the inherited-group hint and nothing about sync. */}
              <p>{syncScheduleDetail(channel)}</p>
              <p className="mt-1 opacity-70">{inheritedSettingsHint}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSync()
            }}
            disabled={busy || !channelAllows(channel, "individual")}
            className="h-8 px-3 text-[10px] uppercase font-bold flex items-center justify-center gap-1.5 bg-app-ink/5 hover:bg-app-ink text-app-ink hover:text-app-bg transition-all disabled:opacity-30 rounded-lg border border-app-ink/10 hover:border-app-ink"
          >
            <RefreshCw size={12} className={isScraping ? "animate-spin" : ""} />
            {channel.isUnavailableOnWebView ? "Recheck" : "Sync"}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {disabledReason(channel, "individual") ??
              "Manual sync resets auto-sync timers"}
          </p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function StartIdField({
  startId,
  onSave,
}: {
  startId: number | undefined
  onSave: (startId: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (value: string) => {
    setDraft(null)
    const parsed = parseStartId(value)
    if (parsed !== null) onSave(parsed)
  }

  return (
    <div className="group/config">
      <p className="text-[10px] uppercase text-app-ink/60 font-bold tracking-widest mb-0.5">
        Start ID
      </p>
      {draft !== null ? (
        <input
          type="text"
          aria-label="Start ID"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft)
            if (e.key === "Escape") setDraft(null)
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-16 bg-transparent text-sm font-bold leading-none focus:outline-none border-b border-app-ink/30"
        />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="flex items-center gap-1.5 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                setDraft((startId ?? "").toString())
              }}
            >
              <p
                className={`text-sm font-bold leading-none group-hover/config:text-app-ink/70 transition-colors ${startId == null ? "text-amber-500" : ""}`}
              >
                {startId == null ? "Auto" : startId.toLocaleString()}
              </p>
              <Edit2
                size={10}
                className="opacity-0 group-hover/config:opacity-40 transition-opacity"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {startId == null
                ? "Start ID will be resolved automatically on next sync"
                : "Edit the starting post ID for syncing"}
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
