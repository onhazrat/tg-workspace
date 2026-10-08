import { getRelativeTime } from "@/lib/utils"

/**
 * A Channel's two sync schedules and its Last sync, as the card face shows
 * them (CARD-01). Relative times go on the face; exact ones only fit the hint.
 */

export interface SyncScheduleFields {
  regularSyncEnabled?: boolean | null
  dynamicSyncEnabled?: boolean | null
  nextRegularSyncAt?: number | null
  nextDynamicSyncAt?: number | null
}

export interface LastSyncFields extends SyncScheduleFields {
  /** The Last sync; absent or 0 when the Channel never synced. */
  lastUpdated?: number | null
  isFrozen?: boolean
  /** Restricted: Telegram's web view no longer serves the Channel. */
  isUnavailableOnWebView?: boolean
}

export type Slot = {
  label: "Regular" | "Dynamic"
  state: "off" | "unscheduled" | "due" | "upcoming"
  /** The next sync time; null when off or unscheduled. */
  at: number | null
}

/**
 * Both schedules. Off means disabled, whatever time is stored. Regular
 * defaults to on and Dynamic to off when the Channel says nothing.
 */
export function syncSlots(channel: SyncScheduleFields, now: number): Slot[] {
  const slot = (
    label: Slot["label"],
    enabled: boolean,
    at: number | null | undefined,
  ): Slot => {
    if (!enabled) return { label, state: "off", at: null }
    if (!at) return { label, state: "unscheduled", at: null }
    return { label, state: at <= now ? "due" : "upcoming", at }
  }
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

/** One schedule on the face: "in 3h", "due, 2h ago", "not scheduled" or "off". */
export function slotText(slot: Slot): string {
  if (slot.state === "off") return "off"
  if (slot.state === "unscheduled" || slot.at === null) return "not scheduled"
  const relative = getRelativeTime(slot.at)
  return slot.state === "due" ? `due, ${relative.toLowerCase()}` : relative
}

/** The earliest enabled schedule, "next in 40m", for cards and compact cards. */
export function nextSyncText(slots: Slot[]): string {
  const timed = slots.filter((slot) => slot.at !== null)
  if (timed.length === 0)
    return slots.some((slot) => slot.state !== "off")
      ? "not scheduled"
      : "schedules off"
  const earliest = timed.reduce((a, b) => ((a.at ?? 0) <= (b.at ?? 0) ? a : b))
  return `next ${slotText(earliest)}`
}

/** Both schedules with exact times, for the hint that has room for them. */
export function syncScheduleDetail(
  channel: SyncScheduleFields,
  now = Date.now(),
): string {
  return syncSlots(channel, now)
    .map(
      (slot) =>
        `${slot.label} ${slot.at === null ? slotText(slot) : new Date(slot.at).toLocaleString()}`,
    )
    .join(" · ")
}

export type LastSyncState = "on-schedule" | "due" | "late" | "never" | "idle"

/** How far past its next sync time an enabled schedule must be to read as late. */
export const LATE_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Whether the Last sync is on schedule. Nothing is expected of a Frozen or
 * Restricted Channel or one with both schedules off, so it is idle before it
 * can be never or late. Judged against the schedules rather than a fixed age,
 * so a weekly Channel stays on schedule all week.
 */
export function lastSyncState(
  channel: LastSyncFields,
  now: number,
): LastSyncState {
  const enabled = syncSlots(channel, now).filter((s) => s.state !== "off")
  if (
    channel.isFrozen ||
    channel.isUnavailableOnWebView ||
    enabled.length === 0
  )
    return "idle"
  if (!channel.lastUpdated) return "never"
  const due = enabled.filter((slot) => slot.state === "due")
  if (due.some((slot) => now - (slot.at ?? now) >= LATE_AFTER_MS)) return "late"
  return due.length > 0 ? "due" : "on-schedule"
}
