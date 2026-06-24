import { toast } from "sonner"

import {
  addChannelByName,
  normalizeChannelHandle,
  toAddChannelContext,
} from "@/lib/channels/add-channel"
import { deleteChannelByRecord } from "@/lib/channels/delete-channel"
import type { CommandContext, CommandDef } from "@/lib/commands/types"
import type { Channel } from "@/types"

function applyPostSearchQuery(
  ctx: CommandContext,
  value: string,
): Promise<void> {
  const query = value.trim()
  ctx.setPostSearch(query)
  ctx.setSemanticSearchQuery("")
  ctx.setRelatedPostSearch(null)
  return ctx.handleFilterPosts(query)
}

function applySummarySearchQuery(ctx: CommandContext, value: string): void {
  ctx.setHistorySearchQuery(value.trim())
}

type ChannelOpKind = "entity-root" | "editor"

export interface ChannelOpDef {
  id: string
  label: string
  kind: ChannelOpKind
  group: string
  keywords: string[]
  entityFlow?: CommandDef["entityFlow"]
  requiresConfirmation?: boolean
  closeOnPick?: boolean
  closeOnApply?: boolean
  allowEmptyApply?: boolean
  searchResultsKind?: CommandDef["searchResultsKind"]
  disabled?: CommandDef["disabled"]
  getConfirmDescription?: CommandDef["getConfirmDescription"]
  editorField?: CommandDef["editorField"]
  run: CommandDef["run"]
}

function offlineDisabled(reason: string) {
  return (ctx: CommandContext) =>
    ctx.isOffline ? { disabled: true, reason } : { disabled: false }
}

const CHANNEL_OPS: ChannelOpDef[] = [
  {
    id: "add-channel",
    kind: "editor",
    label: "Add Channel",
    keywords: ["channel", "add", "follow", "subscribe", "single", "one"],
    group: "Channels",
    closeOnApply: false,
    disabled: offlineDisabled("Server offline — cannot fetch channel info"),
    editorField: {
      id: "channelHandle",
      label: "Channel handle",
      type: "text",
      getValue: () => "",
      apply: async (ctx, value) => {
        await addChannelByName(value, toAddChannelContext(ctx))
      },
    },
    run: () => {},
  },
  {
    id: "delete-channel",
    kind: "entity-root",
    label: "Delete Channel",
    keywords: ["channel", "delete", "remove", "single", "one"],
    group: "Channels",
    entityFlow: "delete-channel",
    requiresConfirmation: true,
    getConfirmDescription: (_ctx, payload) => {
      const channel = payload as Channel | undefined
      if (!channel) {
        return "Delete this channel and all locally cached posts? Server data is removed."
      }
      return `Delete @${channel.name} and all locally cached posts for this channel? Server data is removed.`
    },
    disabled: (ctx) => {
      if (ctx.isOffline) {
        return { disabled: true, reason: "Server offline" }
      }
      if (ctx.channels.length === 0) {
        return { disabled: true, reason: "No channels added" }
      }
      return { disabled: false }
    },
    run: async (ctx, payload) => {
      const channel =
        (payload as Channel | undefined) ??
        (ctx.palette.confirmPayload as Channel | undefined)
      if (!channel) return
      await deleteChannelByRecord(channel, ctx)
      toast.success(`Deleted @${channel.name}`)
    },
  },
  {
    id: "sync-channel",
    kind: "entity-root",
    label: "Sync Channel",
    keywords: ["channel", "sync", "scrape", "fetch", "single", "one"],
    group: "Sync",
    entityFlow: "sync-channel",
    disabled: (ctx) => {
      if (ctx.isOffline) {
        return { disabled: true, reason: "Server offline" }
      }
      if (ctx.channels.length === 0) {
        return { disabled: true, reason: "No channels added" }
      }
      return { disabled: false }
    },
    run: () => {},
  },
  {
    id: "search-posts",
    kind: "editor",
    label: "Search Posts",
    keywords: ["post", "posts", "search", "find", "filter", "text"],
    group: "Posts",
    allowEmptyApply: true,
    closeOnApply: false,
    searchResultsKind: "posts",
    editorField: {
      id: "postSearchQuery",
      label: "Search posts",
      type: "text",
      getValue: (ctx) => ctx.postSearch,
      apply: (ctx, value) => applyPostSearchQuery(ctx, value),
    },
    run: () => {},
  },
  {
    id: "search-summaries",
    kind: "editor",
    label: "Search Summaries",
    keywords: ["summary", "summaries", "history", "search", "find", "filter"],
    group: "Summaries",
    allowEmptyApply: true,
    closeOnApply: false,
    searchResultsKind: "summaries",
    editorField: {
      id: "historySearchQuery",
      label: "Search summaries",
      type: "text",
      getValue: (ctx) => ctx.historySearchQuery,
      apply: (ctx, value) => applySummarySearchQuery(ctx, value),
    },
    run: () => {},
  },
]

function toCommandDef(op: ChannelOpDef): CommandDef {
  return {
    id: op.id,
    kind: op.kind,
    label: op.label,
    keywords: op.keywords,
    group: op.group,
    entityFlow: op.entityFlow,
    requiresConfirmation: op.requiresConfirmation,
    closeOnPick: op.closeOnPick,
    closeOnApply: op.closeOnApply,
    disabled: op.disabled,
    getConfirmDescription: op.getConfirmDescription,
    editorField: op.editorField,
    allowEmptyApply: op.allowEmptyApply,
    searchResultsKind: op.searchResultsKind,
    run: op.run,
  }
}

export function buildChannelOpsCommands(): CommandDef[] {
  return CHANNEL_OPS.map(toCommandDef)
}

export function buildChannelOpRegistry(): ChannelOpDef[] {
  return CHANNEL_OPS
}

export { normalizeChannelHandle }
