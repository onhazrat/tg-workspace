/**
 * Reading an Artifact's frozen Scope, which is the only copy there is (AW-07).
 *
 * Every Artifact used to carry `channels`, `startDate` and `endDate` beside the
 * frozen `scope` that superseded them. AW-07 dropped that trio server-side and
 * deleted the rows that had nothing but the trio, so a screen asking "which
 * channels was this made from" has exactly one place to look.
 *
 * Two one-liners rather than `?.channels ?? []` spelled out at a dozen call
 * sites, because the interesting part is what they answer for an Artifact that
 * records **no** Scope — one a legacy `PUT` door opened. That is an empty list
 * and a `null` range, never a `[0, 0)` window: a zero-width window is one the
 * server refuses, so restoring it leaves the workspace 422ing on every read
 * until somebody thinks to look at the date range.
 */

import type { FrozenScope } from "@/client"
import { formatDateRange } from "@/lib/format-date-range"
import { formatElapsed } from "@/lib/scope/window"

/** What a Scope holds, on anything that carries one. */
interface HasScope {
  scope?: FrozenScope | null
}

/** The channels an Artifact was made from; `[]` when it records no Scope. */
export function scopeChannels(artifact: HasScope | null | undefined): string[] {
  return artifact?.scope?.channels ?? []
}

/** The window an Artifact was made from, or `null` when it records no Scope. */
export function scopeRange(
  artifact: HasScope | null | undefined,
): { start: number; end: number } | null {
  const scope = artifact?.scope
  if (!scope) return null
  return { start: scope.start, end: scope.end }
}

/**
 * An Artifact's frozen window, as exact local boundaries plus Duration (AW-08).
 *
 * Exact on both ends and never relative: "3h ago" describes a window that is
 * still moving, and an Artifact's is not. End gap and the workspace mode the
 * window was submitted under are deliberately absent for the same reason —
 * they are facts about a live workspace, not about a frozen result.
 *
 * Duration is derived from the pair rather than read off `durationMinutes`,
 * so a stored projection cannot disagree with the boundaries beside it.
 */
export function artifactWindowText(
  artifact: HasScope | null | undefined,
  locale?: string,
): string | null {
  const range = scopeRange(artifact)
  // A `(0, 0)` pair is the zero-width window AW-02 refuses, so it is not a
  // window to render and not one to restore either — the caller keys its
  // **Use this Scope** action off this answer, and restoring it would leave
  // the workspace on a one-minute window at the epoch.
  if (!range || range.end <= range.start) return null
  const stamps = formatDateRange(
    new Date(range.start),
    new Date(range.end),
    locale,
  )
  return `${stamps} · ${formatElapsed(range.end - range.start)}`
}
