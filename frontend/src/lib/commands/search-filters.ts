import { api } from "@/api"
import type { CommandContext } from "@/lib/commands/types"
import { listSummaries } from "@/lib/summaries/store"
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
 * Palette post search, run in SQL (A1).
 *
 * This used to pull **every post in the selected date range** into the browser
 * and filter the array — for a wide scope that is the whole corpus, fetched on
 * every keystroke, to display at most fifty rows.
 *
 * It needs no new endpoint. The feed's `keyword` filter is already
 * character-for-character the same predicate: `post_filters._keyword_clause` is
 * `lower(text) LIKE %q% OR lower(channel_name) LIKE %q%`, which is exactly what
 * `filterPostsByTextQuery` does. Sorting and the cap move server-side with it,
 * so the browser now receives at most `SEARCH_RESULTS_CAP` rows.
 *
 * `filterPostsByTextQuery` is kept and still exported — the semantic/related
 * search path and the offline fallback both filter arrays they already hold.
 */
export async function searchPostsForPalette(
  ctx: CommandContext,
  query: string,
): Promise<Post[]> {
  const range = ctx.postDateRange ?? {
    startDate: 0,
    endDate: Date.now(),
  }
  const selectedNames = Array.from(ctx.selectedChannels)
  if (!query.trim()) return []
  // No selection means no scope. The old path was inconsistent about this: its
  // IndexedDB branch looped over the channel list and so returned nothing, while
  // its server branch omitted `channelNames` entirely and so returned the whole
  // corpus — which of the two ran depended on cache staleness. Searching
  // everything when the user has selected nothing is the wrong half of that
  // accident to keep.
  if (selectedNames.length === 0) return []

  return api.getPostsFeed({
    channelNames: selectedNames,
    startDate: range.startDate,
    endDate: range.endDate,
    keyword: query.trim(),
    sort: "time",
    limit: SEARCH_RESULTS_CAP,
  })
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
      .querySelector(`[data-artifact-id="${summary.id}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" })
  })
}
