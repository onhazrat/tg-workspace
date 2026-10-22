/**
 * The History tab's rules, with no React, so they can be tested directly.
 * `HistoryView` keeps the queries, the writes and the toasts.
 */
import type { HistoryParams, HistorySort } from "@/lib/history/history-params"
import type { ArtifactListItem } from "@/types"
import { ARTIFACT_KIND_LABELS } from "./artifact-presentation"

export type SummaryFlag = "autoRegenerate" | "autoPublish"

/**
 * What flipping a Summary's schedule flag does: nothing for another kind, a
 * refusal, or the value to write.
 *
 * A scope shorter than a minute would have the job re-running over a window
 * that barely moves. Read off the frozen Scope since AW-07: a Summary with none
 * has no window to shift at all, which the server refuses too, so it fails the
 * same check. Turning the flag off is always allowed.
 */
export function summaryFlagChange(
  artifact: ArtifactListItem,
  flag: SummaryFlag,
): { next: boolean } | { refusal: string } | null {
  if (artifact.kind !== "summary") return null
  const next = !artifact[flag]
  if (
    flag === "autoRegenerate" &&
    next &&
    (artifact.scope?.durationMinutes ?? 0) < 1
  )
    return {
      refusal:
        "Cannot auto-regenerate a summary whose range is under a minute.",
    }
  return { next }
}

/**
 * How many filters are on, for the phone's Filters button: Kind, Status,
 * Starred and the time filter. The search box sits beside the button.
 */
export function historyActiveFilters(p: HistoryParams): number {
  const bounded = p.bound.start !== undefined || p.bound.end !== undefined
  return [p.kind, p.status, p.starred, bounded].filter(Boolean).length
}

/** The empty list says whether a filter hid everything or nothing exists yet. */
export function historyEmptyDescription(p: HistoryParams): string {
  return p.search.trim() || historyActiveFilters(p) > 0
    ? "No artifacts match these filters."
    : "Summaries, chats, tag runs and discovery reports you create will appear here."
}

/** The footer's sort in words: "Sorted by Written, newest first". */
export function historySortWords(sort: HistorySort, descending: boolean) {
  return `Sorted by ${sort === "written" ? "Written" : "Window start"}, ${
    descending ? "newest first" : "oldest first"
  }`
}

/** "Today", "Yesterday", then "Mon, Oct 19", with the year when not this one. */
function dayLabel(day: Date, now: Date, locale?: string): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return day.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(day.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  })
}

/**
 * The loaded rows under day headings by local calendar day of Written, in
 * list order. A heading carries no count: on a paged list it would count only
 * the loaded rows.
 */
export function historyDays(
  rows: readonly ArtifactListItem[],
  now = Date.now(),
  locale?: string,
): { key: string; label: string; rows: ArtifactListItem[] }[] {
  const days: { key: string; label: string; rows: ArtifactListItem[] }[] = []
  let last: number | null = null
  for (const row of rows) {
    const at = new Date(row.timestamp ?? 0)
    const day = new Date(at.getFullYear(), at.getMonth(), at.getDate())
    const current = days.at(-1)
    if (current && day.getTime() === last) current.rows.push(row)
    else
      days.push({
        key: `${day.getTime()}:${days.length}`,
        label: dayLabel(day, new Date(now), locale),
        rows: [row],
      })
    last = day.getTime()
  }
  return days
}

/** The empty state is for a settled answer, never for a first load in flight. */
export const historyShowsEmpty = (rowCount: number, isLoading: boolean) =>
  rowCount === 0 && !isLoading

/**
 * The delete dialog names the kind and the channels. It keeps its words while
 * closing, when `pending` is already null.
 */
export function deleteDialogCopy(pending: ArtifactListItem | null): {
  title: string
  description: string
} {
  const kind = pending ? ARTIFACT_KIND_LABELS[pending.kind] : "item"
  return {
    title: `Delete this ${kind}?`,
    description:
      pending?.scope?.channels?.join(", ") || "This cannot be undone.",
  }
}
