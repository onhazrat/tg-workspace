import { toast } from "sonner"

import { api } from "@/api"
import { JOB_LABELS, SERVER_JOB_IDS } from "@/hooks/useJobToggles"
import { clearTable } from "@/lib/cache"
import {
  backfillSyncChannel,
  bulkBackfillPartialHistoryChannels,
} from "@/lib/channels/backfill-sync"
import { getTagNames } from "@/lib/channels/channel-tag-model"
import {
  addTagToChannel,
  selectChannelsByTag,
} from "@/lib/channels/channel-tags"
import { deleteSelectedChannels } from "@/lib/channels/delete-selected"
import { refreshChannelMetadata } from "@/lib/channels/refresh-metadata"
import {
  bulkResetSyncAllChannels,
  resetAndSyncChannel,
} from "@/lib/channels/reset-sync"
import { getChannelGridSortFromStorage } from "@/lib/channels/sort-channels-for-grid"
import { applyTrimChannelSelection } from "@/lib/channels/trim-selected-channels"
import { updateChannelStartId } from "@/lib/channels/update-start-id"
import { copyChannelTelegramChatId } from "@/lib/commands/channel-telegram-chat-id-commands"
import { filterPartialHistoryChannels } from "@/lib/commands/filter-channels"
import { parseOpenPostInput } from "@/lib/commands/open-post"
import {
  applyForwardedFilter,
  applyMediaFilter,
  applyPostDateRangeHours,
  clearPostFilters,
  FORWARDED_FILTER_OPTIONS,
  MEDIA_FILTER_OPTIONS,
  POST_DATE_RANGE_PRESETS,
} from "@/lib/commands/post-filters"
import { pickSearchPost } from "@/lib/commands/search-filters"
import type {
  CommandContext,
  CommandDef,
  EntityFlowType,
} from "@/lib/commands/types"
import { restartTorService, rotateTorIpNow } from "@/lib/network/tor-actions"
import { deleteSummary, importIndexedDBToServer } from "@/lib/repository"
import type { Channel, Summary } from "@/types"

function offlineDisabled(reason: string) {
  return (ctx: CommandContext) =>
    ctx.isOffline ? { disabled: true, reason } : { disabled: false }
}

function embeddingsDisabled(ctx: CommandContext) {
  if (ctx.isOffline) {
    return { disabled: true, reason: "Server offline" }
  }
  if (!ctx.settings.embeddingsEnabled) {
    return { disabled: true, reason: "Embeddings disabled in settings" }
  }
  return { disabled: false }
}

function partialHistoryDisabled(ctx: CommandContext) {
  if (ctx.isOffline) {
    return { disabled: true, reason: "Server offline" }
  }
  if (filterPartialHistoryChannels(ctx.channels).length === 0) {
    return { disabled: true, reason: "No channels with partial history" }
  }
  return { disabled: false }
}

export function buildExtendedCommands(): CommandDef[] {
  const commands: CommandDef[] = [
    // --- Channels ---
    {
      id: "reset-sync-channel",
      kind: "entity-root",
      label: "Reset & Sync Channel",
      keywords: ["channel", "reset", "sync", "re-sync", "backfill"],
      group: "Channels",
      entityFlow: "reset-sync-channel",
      requiresConfirmation: true,
      getConfirmDescription: (_ctx, payload) => {
        const channel = payload as Channel | undefined
        if (!channel) {
          return "Clear stored posts and re-backfill this channel from the latest page backward?"
        }
        return `Reset & sync @${channel.name}? Clears local posts and re-backfills from ID ${channel.startId ?? 1}.`
      },
      disabled: offlineDisabled("Server offline"),
      run: async (ctx, payload) => {
        const channel =
          (payload as Channel | undefined) ??
          (ctx.palette.confirmPayload as Channel | undefined)
        if (!channel) return
        await resetAndSyncChannel(channel, ctx)
      },
    },
    {
      id: "fix-partial-history-channel",
      kind: "entity-root",
      label: "Fix Partial History (Channel)",
      keywords: [
        "channel",
        "partial",
        "history",
        "incomplete",
        "cutoff",
        "retention",
        "backfill",
        "reset",
        "sync",
      ],
      group: "Sync",
      entityFlow: "fix-partial-history-channel",
      closeOnPick: false,
      requiresConfirmation: true,
      getConfirmDescription: (_ctx, payload) => {
        const channel = payload as Channel | undefined
        if (!channel) {
          return "Resume backfill for this channel toward the retention window?"
        }
        return `Fix partial history for @${channel.name}? Resumes backfill toward the retention window without clearing stored posts.`
      },
      disabled: partialHistoryDisabled,
      run: async (ctx, payload) => {
        const channel =
          (payload as Channel | undefined) ??
          (ctx.palette.confirmPayload as Channel | undefined)
        if (!channel) return
        await backfillSyncChannel(channel, ctx)
      },
    },
    {
      id: "delete-selected-channels",
      kind: "action",
      label: "Delete Selected Channels",
      keywords: ["channel", "delete", "selected", "bulk", "remove"],
      group: "Channels",
      requiresConfirmation: true,
      confirmDescription:
        "Delete all selected channels and their locally cached posts? Server data is removed.",
      disabled: (ctx) => {
        if (ctx.isOffline) return { disabled: true, reason: "Server offline" }
        if (ctx.selectedChannels.size === 0) {
          return { disabled: true, reason: "No channels selected" }
        }
        return { disabled: false }
      },
      run: async (ctx) => {
        await deleteSelectedChannels(ctx)
      },
    },
    {
      id: "trim-channel-selection",
      kind: "editor",
      label: "Trim Channel Selection to N…",
      keywords: ["channel", "trim", "selection", "limit", "shrink", "top"],
      group: "Channels",
      disabled: (ctx) =>
        ctx.selectedChannels.size === 0
          ? { disabled: true, reason: "No channels selected" }
          : { disabled: false },
      editorField: {
        id: "trimChannelCount",
        label: "Keep first N selected channels by current sort order",
        type: "number",
        min: 1,
        integer: true,
        getValue: () => {
          const saved = localStorage.getItem("channelGrid_trimCount")
          return saved && Number.parseInt(saved, 10) > 0
            ? Number.parseInt(saved, 10)
            : ""
        },
        apply: (ctx, value) => {
          const count = Number.parseInt(value, 10)
          const { sortBy, sortDirection } = getChannelGridSortFromStorage()
          applyTrimChannelSelection({
            channels: ctx.channels,
            channelStats: ctx.channelStats,
            selectedChannels: ctx.selectedChannels,
            sortBy,
            sortDirection,
            count,
            setSelectedChannels: (next) => ctx.setSelectedChannels(next),
          })
          if (Number.isFinite(count) && count >= 1) {
            localStorage.setItem("channelGrid_trimCount", String(count))
          }
        },
      },
      run: () => {},
    },
    {
      id: "add-tag-channel",
      kind: "entity-root",
      label: "Add Tag to Channel",
      keywords: ["channel", "tag", "add", "label"],
      group: "Channels",
      entityFlow: "add-tag-channel",
      run: () => {},
    },
    {
      id: "remove-tag-channel",
      kind: "entity-root",
      label: "Remove Tag from Channel",
      keywords: ["channel", "tag", "remove", "label"],
      group: "Channels",
      entityFlow: "remove-tag-channel",
      disabled: (ctx) =>
        ctx.channels.every((channel) => getTagNames(channel.tags).length === 0)
          ? { disabled: true, reason: "No channel tags defined" }
          : { disabled: false },
      run: () => {},
    },
    {
      id: "edit-channel-start-id",
      kind: "entity-root",
      label: "Edit Channel Start Message ID",
      keywords: ["channel", "start", "id", "message", "sync"],
      group: "Channels",
      entityFlow: "edit-start-id-channel",
      run: () => {},
    },
    {
      id: "select-channels-by-tag",
      kind: "editor",
      label: "Select Channels by Tag",
      keywords: ["channel", "tag", "select", "filter"],
      group: "Channels",
      editorField: {
        id: "tagName",
        label: "Tag name",
        type: "text",
        getValue: () => "",
        apply: (ctx, value) => {
          selectChannelsByTag(value, ctx)
        },
      },
      run: () => {},
    },
    {
      id: "refresh-channel-metadata",
      kind: "entity-root",
      label: "Refresh Channel Metadata",
      keywords: ["channel", "refresh", "metadata", "info", "avatar"],
      group: "Channels",
      entityFlow: "refresh-metadata-channel",
      disabled: offlineDisabled("Server offline — cannot fetch channel info"),
      run: async (ctx, payload) => {
        const channel = payload as Channel | undefined
        if (!channel) return
        await refreshChannelMetadata(channel, ctx)
      },
    },

    // --- Sync ---
    {
      id: "pause-auto-sync-10m",
      kind: "action",
      label: "Pause Auto-Sync for 10 Minutes",
      keywords: ["auto-sync", "pause", "stop", "10 minutes"],
      group: "Sync",
      disabled: offlineDisabled("Server offline"),
      run: async (ctx) => {
        const until = Date.now() + 10 * 60 * 1000
        await api.putSetting("sync", { autoSyncPauseUntil: until })
        ctx.setAutoSyncPauseUntil(until)
        toast.success("Auto-sync paused for 10 minutes")
      },
    },
    {
      id: "fix-all-partial-history",
      kind: "action",
      label: "Fix All Partial History",
      keywords: [
        "partial",
        "history",
        "incomplete",
        "cutoff",
        "retention",
        "backfill",
        "reset",
        "sync",
        "bulk",
        "all",
      ],
      group: "Sync",
      requiresConfirmation: true,
      getConfirmDescription: (ctx) => {
        const count = filterPartialHistoryChannels(ctx.channels).length
        return `Fix partial history for ${count} channel(s)? Resumes backfill toward the retention window without clearing stored posts.`
      },
      disabled: partialHistoryDisabled,
      run: async (ctx) => {
        await bulkBackfillPartialHistoryChannels(ctx)
      },
    },
    {
      id: "bulk-reset-sync-all",
      kind: "action",
      label: "Bulk Reset & Sync All Channels",
      keywords: ["reset", "sync", "all", "bulk", "re-sync", "channels"],
      group: "Sync",
      requiresConfirmation: true,
      confirmDescription:
        "Clear stored posts and re-backfill ALL channels from the latest page backward to the retention window?",
      disabled: offlineDisabled("Server offline"),
      run: async (ctx) => {
        await bulkResetSyncAllChannels(ctx)
      },
    },
    {
      id: "reload-channels",
      kind: "action",
      label: "Reload Channels",
      keywords: ["channels", "reload", "refresh", "load"],
      group: "Navigate",
      run: async (ctx) => {
        await ctx.loadChannels()
        toast.success("Channels reloaded")
      },
    },

    // --- Posts ---
    {
      id: "semantic-search-posts",
      kind: "editor",
      label: "Semantic Search Posts",
      keywords: ["post", "semantic", "search", "embedding", "rag", "similar"],
      group: "Posts",
      closeOnApply: false,
      searchResultsKind: "posts",
      disabled: embeddingsDisabled,
      editorField: {
        id: "semanticQuery",
        label: "Semantic search query",
        type: "text",
        getValue: (ctx) => ctx.palette.searchResultsState?.query ?? "",
        apply: async (ctx, value) => {
          const query = value.trim()
          ctx.setSemanticSearchQuery(query)
          ctx.setPostSearch("")
          ctx.setRelatedPostSearch(null)
          await ctx.handleFilterPosts("")
        },
      },
      run: () => {},
    },
    {
      id: "find-related-posts",
      kind: "entity-root",
      label: "Find Related Posts",
      keywords: ["post", "related", "similar", "embedding"],
      group: "Posts",
      entityFlow: "pick-post",
      disabled: embeddingsDisabled,
      run: async (ctx, payload) => {
        const post = payload as import("@/types").Post | undefined
        if (!post) return
        ctx.setRelatedPostSearch(post)
        ctx.setSemanticSearchQuery("")
        ctx.setPostSearch("")
        await ctx.handleFilterPosts()
        ctx.setActiveTab("posts")
        toast.success(
          `Showing posts related to @${post.channelName} #${post.id}`,
        )
      },
    },
    {
      id: "clear-post-filters",
      kind: "action",
      label: "Clear Post Filters",
      keywords: ["post", "filter", "clear", "reset"],
      group: "Posts",
      run: async (ctx) => {
        clearPostFilters(ctx)
        await ctx.handleFilterPosts("")
        toast.success("Post filters cleared")
      },
    },
    {
      id: "open-post-by-id",
      kind: "editor",
      label: "Open Post by ID",
      keywords: ["post", "open", "id", "navigate", "goto"],
      group: "Posts",
      editorField: {
        id: "openPostTarget",
        label: "Channel and post ID (e.g. channelname 12345)",
        type: "text",
        getValue: () => "",
        apply: (ctx, value) => {
          const target = parseOpenPostInput(value)
          if (!target) {
            toast.error("Enter channel and post ID (e.g. channelname 12345)")
            return
          }
          pickSearchPost(ctx, {
            id: target.postId,
            channelName: target.channelName,
            text: "",
            date: "",
            timestamp: Date.now(),
          })
        },
      },
      run: () => {},
    },

    // --- Summaries ---
    {
      id: "delete-summary",
      kind: "entity-root",
      label: "Delete Summary",
      keywords: ["summary", "delete", "history", "remove"],
      group: "Summaries",
      entityFlow: "delete-summary",
      requiresConfirmation: true,
      getConfirmDescription: (_ctx, payload) => {
        const summary = payload as Summary | undefined
        if (!summary) return "Delete this summary from history?"
        const channels = summary.channels.join(", ") || "summary"
        return `Delete summary for ${channels}?`
      },
      disabled: (ctx) =>
        ctx.summariesHistory.length === 0
          ? { disabled: true, reason: "No summaries in history" }
          : { disabled: false },
      run: async (ctx, payload) => {
        const summary =
          (payload as Summary | undefined) ??
          (ctx.palette.confirmPayload as Summary | undefined)
        if (!summary) return
        await deleteSummary(summary.id)
        await ctx.loadHistory()
        toast.success("Summary deleted")
      },
    },
    {
      id: "show-starred-summaries-only",
      kind: "action",
      label: "Show Starred Summaries Only",
      keywords: ["summary", "starred", "favorite", "filter", "history"],
      group: "Summaries",
      getBadge: (ctx) => (ctx.starredOnly ? "ON" : "OFF"),
      run: (ctx) => {
        ctx.setStarredOnly(!ctx.starredOnly)
      },
    },

    // --- Settings ---
    {
      id: "rotate-tor-ip",
      kind: "action",
      label: "Rotate Tor IP Now",
      keywords: ["tor", "ip", "rotate", "identity", "newnym"],
      group: "Settings",
      disabled: offlineDisabled("Server offline"),
      run: async (ctx) => {
        await rotateTorIpNow(ctx)
      },
    },
    {
      id: "restart-tor",
      kind: "action",
      label: "Restart Tor",
      keywords: ["tor", "restart", "network"],
      group: "Settings",
      requiresConfirmation: true,
      confirmDescription:
        "Restart the Tor service? Active connections may drop.",
      disabled: offlineDisabled("Server offline"),
      run: async (ctx) => {
        await restartTorService(ctx)
      },
    },

    // --- Data ---
    {
      id: "refresh-database-stats",
      kind: "action",
      label: "Refresh Database Stats",
      keywords: ["database", "stats", "refresh", "indexeddb"],
      group: "Data",
      run: async (ctx) => {
        await ctx.loadDBStats?.()
        toast.success("Database stats refreshed")
      },
    },
    {
      id: "migrate-local-to-server",
      kind: "action",
      label: "Migrate Local Data to Server",
      keywords: ["migrate", "server", "upload", "indexeddb", "postgres"],
      group: "Data",
      requiresConfirmation: true,
      confirmDescription:
        "Export all IndexedDB data and upload to PostgreSQL? Matching server records will be updated.",
      disabled: offlineDisabled("Server offline"),
      run: async (ctx) => {
        const imported = await importIndexedDBToServer()
        const summary = Object.entries(imported)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ")
        toast.success(`Server migration complete (${summary || "no records"})`)
        await ctx.loadDBStats?.()
        await ctx.loadChannels()
        await ctx.loadHistory()
      },
    },
    {
      id: "clear-indexeddb-table",
      kind: "entity-root",
      label: "Clear IndexedDB Table",
      keywords: ["indexeddb", "table", "clear", "delete", "advanced"],
      group: "Data",
      entityFlow: "clear-db-table",
      requiresConfirmation: true,
      getConfirmDescription: (_ctx, payload) => {
        const table = payload as string | undefined
        if (!table) return "Clear all records in this IndexedDB table?"
        return `Clear all records in table "${table}"? This cannot be undone.`
      },
      when: (ctx) => ctx.settings.advancedMode,
      run: async (ctx, payload) => {
        const tableName =
          (payload as string | undefined) ??
          (ctx.palette.confirmPayload as string | undefined)
        if (!tableName) return
        await clearTable(tableName)
        await ctx.loadDBStats?.()
        toast.success(`Cleared table "${tableName}"`)
      },
    },

    // --- AI ---
    {
      id: "generate-summary-now",
      kind: "action",
      label: "Generate Summary Now",
      keywords: ["summary", "generate", "ai", "llm"],
      group: "AI",
      disabled: offlineDisabled("Server offline — cannot generate summary"),
      run: async (ctx) => {
        await ctx.handleSummarize()
      },
    },
    {
      id: "copy-summary-prompt",
      kind: "action",
      label: "Copy Summary Prompt",
      keywords: ["summary", "prompt", "copy", "clipboard", "external"],
      group: "AI",
      disabled: offlineDisabled("Server offline — cannot build prompt"),
      run: async (ctx) => {
        await ctx.copySummaryPrompt()
      },
    },
    {
      id: "paste-external-summary",
      kind: "editor",
      label: "Paste External Summary",
      keywords: ["summary", "paste", "external", "ai", "response"],
      group: "AI",
      editorField: {
        id: "pastedSummaryText",
        label: "Pasted AI response",
        type: "textarea",
        getValue: () => "",
        apply: async (ctx, value) => {
          const pending = ctx.summariesHistory.find(
            (summary) => summary.status === "pending",
          )
          const summaryId = ctx.currentSummaryId ?? pending?.id
          if (!summaryId) {
            toast.error("No pending summary — use Copy Summary Prompt first")
            return
          }
          const ok = await ctx.completePendingSummary(summaryId, value)
          if (ok) toast.success("External summary saved")
        },
      },
      run: () => {},
    },
  ]

  for (const preset of POST_DATE_RANGE_PRESETS) {
    commands.push({
      id: `set-posts-date-range-${preset.id}`,
      kind: "action",
      label: `Set Posts Date Range → ${preset.label}`,
      keywords: ["post", "date", "range", preset.id, "filter"],
      group: "Posts",
      run: async (ctx) => {
        applyPostDateRangeHours(ctx, preset.hours)
        await ctx.handleFilterPosts(ctx.postSearch)
        toast.success(`Date range set to ${preset.label.toLowerCase()}`)
      },
    })
  }

  for (const option of FORWARDED_FILTER_OPTIONS) {
    commands.push({
      id: `set-forwarded-filter-${option.id}`,
      kind: "action",
      label: `Set Forwarded Filter → ${option.label}`,
      keywords: ["post", "forwarded", "filter", option.id],
      group: "Posts",
      getBadge: (ctx) => (ctx.forwardedFilter === option.value ? "ON" : null),
      run: async (ctx) => {
        applyForwardedFilter(ctx, option.value)
        toast.success(`Forwarded filter: ${option.label}`)
      },
    })
  }

  for (const option of MEDIA_FILTER_OPTIONS) {
    if (option.value === "all") continue
    commands.push({
      id: `set-media-filter-${option.value}`,
      kind: "action",
      label: `Set Media Filter → ${option.label}`,
      keywords: ["post", "media", "filter", option.value, option.label],
      group: "Posts",
      getBadge: (ctx) => (ctx.mediaFilter === option.value ? "ON" : null),
      run: async (ctx) => {
        applyMediaFilter(ctx, option.value)
        toast.success(`Media filter: ${option.label}`)
      },
    })
  }

  for (const jobId of SERVER_JOB_IDS) {
    const label = JOB_LABELS[jobId] ?? jobId
    commands.push({
      id: `trigger-job-${jobId}`,
      kind: "action",
      label: `Trigger Job Now → ${label}`,
      keywords: ["job", "trigger", "run", jobId, label.toLowerCase()],
      group: "Sync",
      disabled: offlineDisabled("Server offline"),
      run: async (ctx) => {
        await api.triggerJob(jobId)
        await ctx.jobToggles.refreshJobStatus()
        toast.success(`Triggered ${label}`)
      },
    })
  }

  return commands
}

export async function runChainedChannelEntityPick(
  flow: EntityFlowType,
  channel: Channel,
  ctx: CommandContext,
): Promise<"editor" | "tag-pick" | "confirm" | "done" | null> {
  switch (flow) {
    case "reset-sync-channel":
    case "fix-partial-history-channel":
      return "confirm"
    case "add-tag-channel":
      ctx.palette.setEntityPayload(channel)
      return "editor"
    case "remove-tag-channel":
      ctx.palette.setEntityPayload(channel)
      return "tag-pick"
    case "edit-start-id-channel":
      ctx.palette.setEntityPayload(channel)
      return "editor"
    case "refresh-metadata-channel":
      await refreshChannelMetadata(channel, ctx)
      return "done"
    case "copy-channel-telegram-chat-id":
      await copyChannelTelegramChatId(channel)
      return "done"
    default:
      return null
  }
}

export function getChainedEditorApply(
  commandId: string,
  ctx: CommandContext,
  value: string,
): Promise<void> | void {
  const channel = ctx.palette.entityPayload as Channel | undefined
  switch (commandId) {
    case "add-tag-channel":
      if (!channel) return
      return addTagToChannel(channel, value, ctx)
    case "edit-channel-start-id":
      if (!channel) return
      return updateChannelStartId(channel, value, ctx)
    default:
      return
  }
}

export function getChainedEditorField(
  commandId: string,
  channel: Channel | undefined,
): { label: string; getValue: () => string } | null {
  switch (commandId) {
    case "add-tag-channel":
      return { label: "Tag name", getValue: () => "" }
    case "edit-channel-start-id":
      return {
        label: `Start message ID for @${channel?.name ?? "channel"}`,
        getValue: () =>
          channel?.startId != null ? String(channel.startId) : "",
      }
    default:
      return null
  }
}
