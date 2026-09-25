/**
 * The History tab's rules, with no React, so they can be tested directly.
 * `HistoryView` keeps the queries, the writes and the toasts.
 */
import type { ArtifactKind, ArtifactListItem } from "@/types"
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

/** The empty list says whether a filter hid everything or nothing exists yet. */
export function historyEmptyDescription(
  searchQuery: string,
  starredOnly: boolean,
  kind: ArtifactKind | null,
): string {
  return searchQuery || starredOnly || kind
    ? "No artifacts match these filters."
    : "Summaries, chats, tag runs and discovery reports you create will appear here."
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

/** The kind filter chip's label and test id; `null` is "All". */
export function kindFilterChip(candidate: ArtifactKind | null): {
  label: string
  testId: string
} {
  return {
    label: candidate ? ARTIFACT_KIND_LABELS[candidate] : "All",
    testId: `history-kind-${candidate ?? "all"}`,
  }
}
