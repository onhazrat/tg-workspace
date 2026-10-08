import { Edit2, RefreshCw } from "lucide-react"
import { useState } from "react"
import { RelativeTime } from "@/components/RelativeTime"
import { disabledReason } from "@/lib/channels/sync-permissions"
import {
  type LastSyncState,
  lastSyncState,
  nextSyncText,
  type Slot,
  slotText,
  syncScheduleDetail,
  syncSlots,
} from "@/lib/channels/sync-schedule-summary"
import { useNow } from "@/lib/shared-ticker"
import type { Channel } from "@/types"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tg-tooltip"
import {
  channelSyncStatus,
  parseStartId,
  syncButtonProps,
} from "./channel-card-status"

/** Green on schedule, amber due, red late or never, grey when nothing is expected. */
const LAST_SYNC_TONE: Record<LastSyncState, string> = {
  "on-schedule": "text-emerald-600",
  due: "text-amber-600",
  late: "text-red-600",
  never: "text-red-600",
  idle: "text-app-ink/45",
}

/**
 * Config and sync row. A compact card shows its Last sync as an age over the
 * next sync; a card adds the Start ID, a status for Restricted or Frozen
 * only, and "Synced 3h ago"; a detailed card lists both schedules.
 */
export function ChannelCardFooter({
  channel,
  showStartId,
  showStatus,
  detailed,
  isScraping,
  busy,
  inheritedSettingsHint,
  onSaveStartId,
  onSync,
}: {
  channel: Channel
  showStartId: boolean
  /** The card's status block; off on the compact card, which shows a line. */
  showStatus: boolean
  /** List both schedules instead of the earliest. */
  detailed: boolean
  isScraping: boolean
  /** A sync or summary is running, so a manual sync must wait. */
  busy: boolean
  inheritedSettingsHint: string
  onSaveStartId: (startId: number) => void
  onSync: () => void
}) {
  const now = useNow()
  const slots = syncSlots(channel, now)
  const state = lastSyncState(channel, now)
  const status = channelSyncStatus(channel)
  const hint = `Last synced ${
    channel.lastUpdated
      ? new Date(channel.lastUpdated).toLocaleString()
      : "never"
  }\n${syncScheduleDetail(channel, now)}\n${inheritedSettingsHint}`

  if (!showStatus)
    return (
      <div className="mt-auto flex items-end justify-between gap-3">
        <div
          title={hint}
          data-last-sync={state}
          className="relative z-20 min-w-0 leading-tight"
        >
          <p className={`text-[11px] font-bold ${LAST_SYNC_TONE[state]}`}>
            <RelativeTime timestamp={channel.lastUpdated ?? undefined} />
          </p>
          <p className="truncate text-[9px] text-app-ink/45">
            {nextSyncText(slots)}
          </p>
        </div>
        <SyncButton
          channel={channel}
          isScraping={isScraping}
          busy={busy}
          onSync={onSync}
        />
      </div>
    )

  return (
    <div className="mt-auto flex items-center justify-between gap-3 pt-4 border-t border-app-ink/5">
      <div className="flex items-start gap-4 flex-wrap">
        {showStartId && (
          <StartIdField startId={channel.startId} onSave={onSaveStartId} />
        )}

        <div title={hint} className="leading-tight">
          {status && (
            <p className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-app-ink/60">
              <span className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`} />
              <span className={status.textClass}>{status.label}</span>
            </p>
          )}
          <p
            data-last-sync={state}
            className={`text-sm font-bold ${LAST_SYNC_TONE[state]}`}
          >
            {channel.lastUpdated ? (
              <>
                Synced <RelativeTime timestamp={channel.lastUpdated} />
              </>
            ) : (
              "Never synced"
            )}
          </p>
          {detailed ? (
            <ScheduleLines slots={slots} />
          ) : (
            <p className="text-[9px] text-app-ink/45">{nextSyncText(slots)}</p>
          )}
        </div>
      </div>

      <SyncButton
        channel={channel}
        isScraping={isScraping}
        busy={busy}
        onSync={onSync}
      />
    </div>
  )
}

const SLOT_TONE: Record<Slot["state"], string> = {
  due: "text-amber-700",
  upcoming: "text-app-ink/70",
  unscheduled: "text-app-ink/35",
  off: "text-app-ink/35",
}

/** Regular and Dynamic, a line each, on the detailed card. */
function ScheduleLines({ slots }: { slots: Slot[] }) {
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[10px] leading-snug">
      {slots.map((slot) => (
        <div
          key={slot.label}
          data-schedule={slot.label}
          data-schedule-state={slot.state}
          className="contents"
        >
          <dt className="text-app-ink/45">{slot.label}</dt>
          <dd className={`font-semibold tabular-nums ${SLOT_TONE[slot.state]}`}>
            {slotText(slot)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function SyncButton({
  channel,
  isScraping,
  busy,
  onSync,
}: {
  channel: Channel
  isScraping: boolean
  busy: boolean
  onSync: () => void
}) {
  const { label, ...sync } = syncButtonProps(channel, busy, onSync)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          {...sync}
          className="relative z-20 h-8 px-3 text-[10px] uppercase font-bold flex items-center justify-center gap-1.5 bg-app-ink/5 hover:bg-app-ink text-app-ink hover:text-app-bg transition-all disabled:opacity-30 rounded-lg border border-app-ink/10 hover:border-app-ink"
        >
          <RefreshCw size={12} className={isScraping ? "animate-spin" : ""} />
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>
          {disabledReason(channel, "individual") ??
            "Manual sync resets auto-sync timers"}
        </p>
      </TooltipContent>
    </Tooltip>
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
