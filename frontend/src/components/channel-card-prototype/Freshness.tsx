// PROTOTYPE: last-sync time on cards. Tiles show none (round 2 verdict).
// Never merge.
import { channelSyncStatus } from "@/components/channel-card/channel-card-status"
import { RelativeTime } from "@/components/RelativeTime"
import {
  syncScheduleDetail,
  syncScheduleSummary,
} from "@/lib/channels/sync-schedule-summary"
import { getRelativeTime } from "@/lib/utils"
import type { Channel, ChannelStats } from "@/types"
import { freshness } from "./shared"

function syncTitle(channel: Channel) {
  return `Last synced ${
    channel.lastUpdated
      ? new Date(channel.lastUpdated).toLocaleString()
      : "never"
  }\n${syncScheduleDetail(channel)}`
}

/**
 * Round 1's pick B: the age coloured (green < 1d, amber
 * < 7d, red older) over the next sync. Left of Sync on the compact card.
 */
export function CompactSyncLine({ channel }: { channel: Channel }) {
  const f = freshness(channel.lastUpdated)
  return (
    <div
      title={syncTitle(channel)}
      className="relative z-20 min-w-0 leading-tight"
    >
      <p className={`text-[11px] font-bold ${f.text}`}>
        <RelativeTime timestamp={channel.lastUpdated} />
      </p>
      <p className="truncate text-[9px] text-app-ink/45">
        next {nextSync(channel)}
      </p>
    </div>
  )
}

/**
 * The full card's Status block in the same language as the compact
 * line, so "Up to date" no longer hides that the last sync was a week ago.
 */
export function CardSyncStatus({
  channel,
  stats,
  detailed,
}: {
  channel: Channel
  stats: ChannelStats | undefined
  /** A detailed card shows both schedules; a normal one the earliest only. */
  detailed: boolean
}) {
  const status = channelSyncStatus(channel, stats)
  const f = freshness(channel.lastUpdated)
  return (
    <div title={syncTitle(channel)} className="leading-tight">
      <p className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-app-ink/60">
        <span className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`} />
        {status.label}
      </p>
      <p className={`text-sm font-bold ${f.text}`}>
        Synced <RelativeTime timestamp={channel.lastUpdated} />
      </p>
      {detailed ? (
        <ScheduleDetail channel={channel} />
      ) : (
        <p className="text-[9px] text-app-ink/45">next {nextSync(channel)}</p>
      )}
    </div>
  )
}

type Slot = {
  label: "Regular" | "Dynamic"
  /** Off, on with no time yet, or the next run. */
  state: "off" | "unscheduled" | "due" | "upcoming"
  at: number | null
}

export function slots(channel: Channel): Slot[] {
  const slot = (
    label: Slot["label"],
    enabled: boolean,
    at: number | null | undefined,
  ): Slot => ({
    label,
    state: !enabled
      ? "off"
      : !at
        ? "unscheduled"
        : at <= Date.now()
          ? "due"
          : "upcoming",
    at: enabled && at ? at : null,
  })
  return [
    slot(
      "Regular",
      channel.regularSyncEnabled ?? true,
      channel.nextRegularSyncAt,
    ),
    slot(
      "Dynamic",
      Boolean(channel.dynamicSyncEnabled),
      channel.nextDynamicSyncAt,
    ),
  ]
}

/** "in 3h", "due 20m ago", "off", "not scheduled". */
export function when(s: Slot): string {
  if (s.state === "off") return "off"
  if (s.state === "unscheduled") return "not scheduled"
  const rel = getRelativeTime(s.at ?? undefined)
  return s.state === "due" ? `due, ${rel}` : rel
}

const slotTone = (s: Slot) =>
  s.state === "due"
    ? "text-amber-700"
    : s.state === "upcoming"
      ? "text-app-ink/70"
      : "text-app-ink/35"

const exact = (s: Slot) =>
  s.at
    ? `${s.label}: ${new Date(s.at).toLocaleString()}`
    : `${s.label}: ${when(s)}`

/** Both schedules on a detailed card, one line each. */
function ScheduleDetail({ channel }: { channel: Channel }) {
  return (
    <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[10px] leading-snug">
      {slots(channel).map((s) => (
        <div key={s.label} className="contents" title={exact(s)}>
          <span className="text-app-ink/45">{s.label}</span>
          <span className={`font-semibold tabular-nums ${slotTone(s)}`}>
            {when(s)}
          </span>
        </div>
      ))}
    </div>
  )
}

function nextSync(channel: Channel): string {
  const times = [
    channel.regularSyncEnabled !== false ? channel.nextRegularSyncAt : null,
    channel.dynamicSyncEnabled ? channel.nextDynamicSyncAt : null,
  ].filter((t): t is number => typeof t === "number" && t > 0)
  if (!times.length)
    return syncScheduleSummary(channel).includes("off") ? "off" : "unscheduled"
  return getRelativeTime(Math.min(...times))
}
