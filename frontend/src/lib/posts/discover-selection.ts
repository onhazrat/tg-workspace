/** Discover multi-select helpers (D5B / D7B). Local follow intent only. */

export const BULK_FOLLOW_CONFIRM_THRESHOLD = 5

export type DiscoverSelectableRow = {
  name: string
  isFollowed: boolean
}

export type HeaderCheckboxState = "checked" | "unchecked" | "indeterminate"

export function needsBulkFollowConfirm(selectedCount: number): boolean {
  return selectedCount >= BULK_FOLLOW_CONFIRM_THRESHOLD
}

/** Followed rows are always checked and not toggleable (D5B). */
export function isRowCheckboxChecked(
  name: string,
  isFollowed: boolean,
  selectedForFollow: ReadonlySet<string>,
): boolean {
  return isFollowed || selectedForFollow.has(name)
}

export function isRowCheckboxDisabled(
  isFollowed: boolean,
  isJobRunning = false,
): boolean {
  return isFollowed || isJobRunning
}

export function getUnfollowedNames(
  candidates: readonly DiscoverSelectableRow[],
): string[] {
  return candidates.filter((row) => !row.isFollowed).map((row) => row.name)
}

export function toggleUnfollowedSelection(
  name: string,
  isFollowed: boolean,
  selectedForFollow: ReadonlySet<string>,
): Set<string> {
  if (isFollowed) return new Set(selectedForFollow)
  const next = new Set(selectedForFollow)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return next
}

export function headerCheckboxState(
  candidates: readonly DiscoverSelectableRow[],
  selectedForFollow: ReadonlySet<string>,
): HeaderCheckboxState {
  const unfollowed = getUnfollowedNames(candidates)
  if (unfollowed.length === 0) return "unchecked"
  const selectedCount = unfollowed.filter((name) =>
    selectedForFollow.has(name),
  ).length
  if (selectedCount === 0) return "unchecked"
  if (selectedCount === unfollowed.length) return "checked"
  return "indeterminate"
}

/** Select all visible unfollowed, or clear them if already all selected. */
export function toggleSelectAllUnfollowed(
  candidates: readonly DiscoverSelectableRow[],
  selectedForFollow: ReadonlySet<string>,
): Set<string> {
  const unfollowed = getUnfollowedNames(candidates)
  const allSelected =
    unfollowed.length > 0 &&
    unfollowed.every((name) => selectedForFollow.has(name))
  const next = new Set(selectedForFollow)
  if (allSelected) {
    for (const name of unfollowed) next.delete(name)
    return next
  }
  for (const name of unfollowed) next.add(name)
  return next
}

/**
 * After a follow job finishes: drop non-error names from local selection;
 * keep failed names so the user can retry (plan Feature 3).
 */
export function pruneSelectionAfterFollow(
  selectedForFollow: ReadonlySet<string>,
  results: readonly { name: string; status: string }[],
): Set<string> {
  const next = new Set(selectedForFollow)
  for (const result of results) {
    if (result.status !== "error") next.delete(result.name)
  }
  return next
}

/**
 * Apply one selection state across a contiguous run of rows — shift-click.
 *
 * Follows the mail-client convention: the state applied to the whole range is
 * the state the *clicked* row ends up in, so shift-clicking a selected row
 * clears the range rather than re-selecting it.
 *
 * Followed rows are skipped, not toggled: their checkbox is disabled, so
 * sweeping over one must not quietly do what clicking it cannot.
 *
 * Indices are resolved by the caller against the rows *currently on screen*,
 * which is what makes the range mean what the user sees after sorting or
 * filtering has reordered the table.
 */
export function selectRange(
  candidates: readonly DiscoverSelectableRow[],
  anchorIndex: number,
  targetIndex: number,
  selected: ReadonlySet<string>,
  shouldSelect: boolean,
): Set<string> {
  const next = new Set(selected)
  if (anchorIndex < 0 || targetIndex < 0) return next
  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  for (let i = start; i <= end; i += 1) {
    const row = candidates[i]
    if (!row || row.isFollowed) continue
    if (shouldSelect) next.add(row.name)
    else next.delete(row.name)
  }
  return next
}

/**
 * Drop names from the selection after a bulk dismiss/restore.
 *
 * Unlike a follow job there is no per-name failure to keep around: the whole
 * batch either applied or the mutation errored, so every acted-on name leaves
 * the selection. The rows also leave the current view (dismissed rows only
 * appear under "Ignored"), so keeping them selected would leave a count
 * referring to rows that are no longer on screen.
 */
export function removeFromSelection(
  selected: ReadonlySet<string>,
  names: readonly string[],
): Set<string> {
  const next = new Set(selected)
  for (const name of names) next.delete(name)
  return next
}

/** Names created by the follow job (added or unavailable) for D10A workspace merge. */
export function createdChannelNamesFromResults(
  results: readonly { name: string; status: string }[],
): string[] {
  return results
    .filter((r) => r.status === "added" || r.status === "unavailable")
    .map((r) => r.name)
}

export function buildBulkFollowChannels(
  names: readonly string[],
  candidatesByName: ReadonlyMap<
    string,
    {
      samplePost?: {
        channelName: string
        postId: number
        timestamp: number
      }
    }
  >,
): {
  name: string
  discoveredVia?: {
    channelName: string
    postId: number
    timestamp: number
  }
}[] {
  return names.map((name) => {
    const sample = candidatesByName.get(name)?.samplePost
    return sample
      ? {
          name,
          discoveredVia: {
            channelName: sample.channelName,
            postId: sample.postId,
            timestamp: sample.timestamp,
          },
        }
      : { name }
  })
}
