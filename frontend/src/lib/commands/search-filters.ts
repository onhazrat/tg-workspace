import type { CommandContext } from "@/lib/commands/types"
import { getPostsByDateRange } from "@/lib/repository"
import type { Post, Summary } from "@/types"

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

export function searchSummariesForPalette(
  ctx: CommandContext,
  query: string,
): Summary[] {
  return filterSummariesByTextQuery(ctx.summariesHistory, query)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, SEARCH_RESULTS_CAP)
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

export function pickSearchSummary(ctx: CommandContext, summary: Summary): void {
  ctx.setActiveTab("history")
  ctx.setCurrentSummaryId(summary.id)
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-history-summary-id="${summary.id}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" })
  })
}
