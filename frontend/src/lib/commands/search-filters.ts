import type { CommandContext } from "@/lib/commands/types"
import { getPostsByDateRange, listSummaries } from "@/lib/repository"
import { searchSimilarPostsFromQuery } from "@/services/rag"
import type { Post, SummaryListItem } from "@/types"

export const SEARCH_RESULTS_CAP = 50

export function filterPostsByTextQuery(posts: Post[], query: string): Post[] {
  if (!query.trim()) return posts
  const normalized = query.toLowerCase()
  return posts.filter(
    (post) =>
      post.text.toLowerCase().includes(normalized) ||
      post.channelName.toLowerCase().includes(normalized),
  )
}

/**
 * Re-exported from lib/summary-projection so the repository layer can share it
 * without depending on the command palette. It now serves the offline fallback
 * — the online path searches in SQL.
 */
export { filterSummariesByTextQuery } from "@/lib/summary-projection"

export async function searchPostsForPalette(
  ctx: CommandContext,
  query: string,
): Promise<Post[]> {
  const range = ctx.postDateRange ?? {
    startDate: 0,
    endDate: Date.now(),
  }
  const selectedNames = Array.from(ctx.selectedChannels)
  const posts = await getPostsByDateRange(
    selectedNames,
    range.startDate,
    range.endDate,
  )
  return filterPostsByTextQuery(posts, query)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, SEARCH_RESULTS_CAP)
}

/**
 * Summary search now runs in SQL — `promptText` is no longer shipped to the
 * client, so matching prompt bodies has to happen where they live. Mirrors
 * `semanticSearchPostsForPalette`, which is async for the same reason.
 */
export async function searchSummariesForPalette(
  _ctx: CommandContext,
  query: string,
): Promise<SummaryListItem[]> {
  const results = await listSummaries(
    query.trim() ? { search: query.trim() } : {},
  )
  return [...results]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, SEARCH_RESULTS_CAP)
}

export async function semanticSearchPostsForPalette(
  ctx: CommandContext,
  query: string,
): Promise<Post[]> {
  if (!query.trim()) return []
  const range = ctx.postDateRange ?? {
    startDate: 0,
    endDate: Date.now(),
  }
  const channels =
    ctx.selectedChannels.size > 0 ? Array.from(ctx.selectedChannels) : undefined
  const posts = await searchSimilarPostsFromQuery(
    query,
    SEARCH_RESULTS_CAP,
    channels,
    range.startDate,
    range.endDate,
  )
  return posts.slice(0, SEARCH_RESULTS_CAP)
}

export function truncatePreview(text: string, maxLength = 80): string {
  const trimmed = text.replace(/\s+/g, " ").trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength - 1)}…`
}

export function pickSearchPost(ctx: CommandContext, post: Post): void {
  ctx.setActiveTab("posts")
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-post-key="${post.channelName}_${post.id}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" })
  })
}

export function pickSearchSummary(
  ctx: CommandContext,
  summary: SummaryListItem,
): void {
  ctx.setActiveTab("history")
  ctx.setCurrentSummaryId(summary.id)
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-history-summary-id="${summary.id}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" })
  })
}
