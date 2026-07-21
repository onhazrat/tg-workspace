import type { Summary, SummaryListItem } from "@/types"

/**
 * Offline mirror of the backend's `_search_clause`.
 *
 * Lives here rather than in `lib/commands/` so the repository layer can reach
 * it without depending on the command palette. Kept field-for-field aligned
 * with the SQL version: divergence shows up as search results that change
 * depending on whether the backend happens to be reachable.
 */
export function filterSummariesByTextQuery(
  summaries: Summary[],
  query: string,
): Summary[] {
  if (!query.trim()) return summaries
  const normalized = query.toLowerCase()
  return summaries.filter((summary) => {
    const matchesChannels = summary.channels.some((channel) =>
      channel.toLowerCase().includes(normalized),
    )
    const matchesText = summary.text.toLowerCase().includes(normalized)
    const matchesPrompt = summary.promptText?.toLowerCase().includes(normalized)
    const matchesModel = summary.model?.toLowerCase().includes(normalized)
    const matchesNote = summary.note?.toLowerCase().includes(normalized)
    return (
      matchesChannels ||
      matchesText ||
      matchesPrompt ||
      matchesModel ||
      matchesNote
    )
  })
}

/** Matches SUMMARY_PROMPT_EXCERPT_CHARS in backend/app/services/summaries.py. */
export const SUMMARY_PROMPT_EXCERPT_CHARS = 80

/**
 * Derive the list projection from a full summary.
 *
 * Used for the offline path: the IndexedDB mirror holds full rows, but the
 * list surfaces consume `SummaryListItem`, so cached rows are projected down
 * to the same shape the server returns. Keeping the truncation rule identical
 * on both sides means the UI cannot tell which path it came from.
 */
export function toSummaryListItem(summary: Summary): SummaryListItem {
  const { citedPosts: _citedPosts, promptText, chatMessages, ...rest } = summary

  const item: SummaryListItem = {
    ...rest,
    chatMessageCount: chatMessages?.length ?? 0,
  }

  if (promptText) {
    const collapsed = promptText.replace(/\s+/g, " ").trim()
    item.promptExcerpt =
      collapsed.length <= SUMMARY_PROMPT_EXCERPT_CHARS
        ? collapsed
        : `${collapsed.slice(0, SUMMARY_PROMPT_EXCERPT_CHARS - 1)}…`
  }

  return item
}
