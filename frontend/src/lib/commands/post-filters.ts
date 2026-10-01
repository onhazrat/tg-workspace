import type { CommandContext } from "@/lib/commands/types"
import { funnelledValues, removeFunnel } from "@/lib/filter-tree"
import {
  addPostFunnel,
  emptyPostFilter,
  type PostType,
} from "@/lib/posts/post-filter"
import { MEDIA_KIND_OPTIONS, type MediaKind } from "@/lib/posts/post-media"

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

export { POST_ORDER_OPTIONS } from "@/lib/posts/post-filter-bar"
export { MEDIA_KIND_OPTIONS }

export function clearPostFilters(ctx: CommandContext): void {
  ctx.setPostSearch("")
  ctx.setSemanticSearchQuery("")
  ctx.setRelatedPostSearch(null)
  ctx.setPostFilter(emptyPostFilter())
  ctx.setMaxPostsPerChannel(0)
  ctx.setMaxPostsPerChannelMode("ordered")
  ctx.setPostSortOrder("newest")
  ctx.setGroupByChannel(false)
}

export function applyPostDateRangeHours(
  ctx: CommandContext,
  hours: number,
): void {
  const end = Date.now()
  const start = end - hours * 60 * 60 * 1000
  ctx.setDateRange(start, end)
}

/** Whether the Post filter funnels on this Type or media kind. */
export const isFunnelled = (
  ctx: CommandContext,
  type: "type" | "media",
  value: PostType | MediaKind,
): boolean => funnelledValues(ctx.postFilter, type).includes(value)

/**
 * Add the Condition a Type or media command names to the Post filter, as the
 * dropdown's funnel does, or take it out again when it is already there
 * (PTR-03). Answers whether it is on now.
 */
export function togglePostFunnel(
  ctx: CommandContext,
  type: "type" | "media",
  value: PostType | MediaKind,
): boolean {
  const on = !isFunnelled(ctx, type, value)
  ctx.setPostFilter(
    on
      ? addPostFunnel(ctx.postFilter, type, value)
      : removeFunnel(ctx.postFilter, type, value),
  )
  void ctx.handleFilterPosts(ctx.postSearch)
  return on
}
