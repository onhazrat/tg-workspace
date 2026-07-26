import { getRelativeTime } from "@/lib/utils"

/**
 * The per-card "next sync" line.
 *
 * This used to interpolate `new Date(...).toLocaleString()` for both schedules,
 * producing `Regular 7/25/2026, 1:58:54 AM · Dynamic 7/25/2026, 2:14:00 AM` — far
 * wider than the 220px the card allows, so every card clipped mid-word and the
 * Dynamic half was never visible on any card.
 *
 * Relative times ("in 3h") are both shorter and more useful at a glance; the exact
 * timestamps move to the tooltip, which previously showed unrelated text.
 */

export interface SyncScheduleFields {
  regularSyncEnabled?: boolean | null
  dynamicSyncEnabled?: boolean | null
  nextRegularSyncAt?: number | null
  nextDynamicSyncAt?: number | null
}

function describe(
  label: string,
  enabled: boolean,
  nextAt: number | null | undefined,
  absolute: boolean,
): string {
  if (!enabled) return `${label} off`
  if (!nextAt) return `${label} not scheduled`
  const when = absolute
    ? new Date(nextAt).toLocaleString()
    : getRelativeTime(nextAt)
  return `${label} ${when}`
}

/**
 * Compact schedule line for the card face — relative times, e.g.
 * `Regular in 3h · Dynamic off`.
 */
export function syncScheduleSummary(channel: SyncScheduleFields): string {
  return [
    describe(
      "Regular",
      channel.regularSyncEnabled ?? true,
      channel.nextRegularSyncAt,
      false,
    ),
    describe(
      "Dynamic",
      Boolean(channel.dynamicSyncEnabled),
      channel.nextDynamicSyncAt,
      false,
    ),
  ].join(" · ")
}

/** Same line with absolute timestamps, for the tooltip that has room for them. */
export function syncScheduleDetail(channel: SyncScheduleFields): string {
  return [
    describe(
      "Regular",
      channel.regularSyncEnabled ?? true,
      channel.nextRegularSyncAt,
      true,
    ),
    describe(
      "Dynamic",
      Boolean(channel.dynamicSyncEnabled),
      channel.nextDynamicSyncAt,
      true,
    ),
  ].join(" · ")
}
