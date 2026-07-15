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
