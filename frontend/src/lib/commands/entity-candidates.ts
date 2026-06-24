import { collectAllChannelTags } from "@/lib/channels/channel-tags"
import type { CommandContext, EntityFlowType } from "@/lib/commands/types"
import type { Channel, Post, Summary } from "@/types"

export function getExtendedEntityCandidates(
  flow: EntityFlowType,
  ctx: CommandContext,
  entityPayload?: unknown,
): Array<{ id: string; label: string }> {
  switch (flow) {
    case "delete-summary":
      return ctx.summariesHistory.map((summary) => ({
        id: summary.id,
        label: formatSummaryLabel(summary),
      }))
    case "pick-post":
      return ctx.filteredPosts.slice(0, 100).map((post) => ({
        id: `${post.channelName}_${post.id}`,
        label: `@${post.channelName} #${post.id}`,
      }))
    case "clear-db-table":
      return (ctx.indexedDbTables ?? []).map((table) => ({
        id: table,
        label: table,
      }))
    case "remove-tag-pick": {
      const channel = entityPayload as Channel | undefined
      if (!channel?.tags?.length) return []
      return channel.tags.map((tag) => ({ id: tag, label: tag }))
    }
    case "remove-tag-channel":
      return ctx.channels
        .filter((channel) => (channel.tags?.length ?? 0) > 0)
        .map((channel) => ({
          id: channel.name,
          label: `@${channel.name}`,
        }))
    default:
      return []
  }
}

export function isNonChannelEntityFlow(flow: EntityFlowType): boolean {
  return (
    flow === "delete-summary" ||
    flow === "pick-post" ||
    flow === "clear-db-table" ||
    flow === "remove-tag-pick"
  )
}

export function isChannelTagEntityFlow(flow: EntityFlowType): boolean {
  return flow === "remove-tag-channel"
}

export function getTagEntityCandidates(
  ctx: CommandContext,
  query: string,
): Array<{ id: string; label: string }> {
  const tags = collectAllChannelTags(ctx.channels)
  const normalized = query.trim().toLowerCase()
  const filtered = normalized
    ? tags.filter((tag) => tag.toLowerCase().includes(normalized))
    : tags
  return filtered.map((tag) => ({ id: tag, label: tag }))
}

function formatSummaryLabel(summary: Summary): string {
  const channels = summary.channels.join(", ") || "Summary"
  const preview = (summary.promptText || summary.text || "").slice(0, 40)
  return `${channels} — ${preview}`
}

export function findPostByEntityId(
  posts: Post[],
  entityId: string,
): Post | undefined {
  const separator = entityId.lastIndexOf("_")
  if (separator <= 0) return undefined
  const channelName = entityId.slice(0, separator)
  const postId = Number.parseInt(entityId.slice(separator + 1), 10)
  if (Number.isNaN(postId)) return undefined
  return posts.find(
    (post) => post.channelName === channelName && post.id === postId,
  )
}
