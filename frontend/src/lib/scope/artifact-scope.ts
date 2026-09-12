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
