import type { CommandContext } from "@/lib/commands/types"

export type ForwardedFilterValue =
  | "all"
  | "forwarded"
  | "original"
  | "unfollowed_forwarded"

export const POST_DATE_RANGE_PRESETS = [
  { id: "24h", label: "Last 24 Hours", hours: 24 },
  { id: "7d", label: "Last 7 Days", hours: 24 * 7 },
  { id: "30d", label: "Last 30 Days", hours: 24 * 30 },
] as const

export const FORWARDED_FILTER_OPTIONS = [
  { id: "original", label: "Original Posts Only", value: "original" as const },
  {
    id: "forwarded",
    label: "Forwarded Posts Only",
    value: "forwarded" as const,
  },
  {
    id: "unfollowed_forwarded",
    label: "Unfollowed Forwarded Posts",
    value: "unfollowed_forwarded" as const,
  },
] as const

export function clearPostFilters(ctx: CommandContext): void {
  ctx.setPostSearch("")
  ctx.setSemanticSearchQuery("")
  ctx.setRelatedPostSearch(null)
  ctx.setForwardedFilter("all")
  ctx.setMaxPostsPerChannel(0)
  ctx.setMaxPostsPerChannelMode("latest")
  ctx.setPostSortOrder("time")
}

export function applyPostDateRangeHours(
  ctx: CommandContext,
  hours: number,
): void {
  const end = Date.now()
  const start = end - hours * 60 * 60 * 1000
  ctx.setDateRange(start, end)
}

export function applyForwardedFilter(
  ctx: CommandContext,
  value: ForwardedFilterValue,
): void {
  ctx.setForwardedFilter(value)
  void ctx.handleFilterPosts(ctx.postSearch)
}
