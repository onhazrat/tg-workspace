import { getTagNames } from "@/lib/channels/channel-tag-model"
import { collectAllChannelTags } from "@/lib/channels/channel-tags"
import { getSettingGroupEntityCandidates } from "@/lib/commands/group-commands"
import type { CommandContext, EntityFlowType } from "@/lib/commands/types"
import type { Channel, Post, SummaryListItem } from "@/types"

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
    // "pick-post" candidates are resolved in useEntityFlow, which fetches the
    // scoped posts on demand rather than reading an eager array.
    case "clear-db-table":
      return (ctx.databaseTables ?? []).map((table) => ({
        id: table,
        label: table,
      }))
    case "remove-tag-pick": {
      const channel = entityPayload as Channel | undefined
      const tagNames = getTagNames(channel?.tags)
      if (!tagNames.length) return []
      return tagNames.map((tag) => ({ id: tag, label: tag }))
    }
    case "remove-tag-channel":
      return ctx.channels
        .filter((channel) => getTagNames(channel.tags).length > 0)
        .map((channel) => ({
          id: channel.name,
          label: `@${channel.name}`,
        }))
    case "filter-by-setting-group":
    case "move-to-setting-group":
    case "open-setting-group":
      return getSettingGroupEntityCandidates(ctx, "")
    default:
      return []
  }
}

export function isSettingGroupEntityFlow(flow: EntityFlowType): boolean {
  return (
    flow === "filter-by-setting-group" ||
    flow === "move-to-setting-group" ||
    flow === "open-setting-group"
  )
}

export function isNonChannelEntityFlow(flow: EntityFlowType): boolean {
  return (
    flow === "delete-summary" ||
    flow === "pick-post" ||
    flow === "clear-db-table" ||
    flow === "remove-tag-pick" ||
    isSettingGroupEntityFlow(flow)
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

function formatSummaryLabel(summary: SummaryListItem): string {
  const channels = summary.channels.join(", ") || "Summary"
  const preview = (summary.promptExcerpt || summary.text || "").slice(0, 40)
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
