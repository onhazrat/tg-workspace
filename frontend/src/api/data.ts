import type {
  BotCredential,
  Channel,
  ChannelStats,
  ChatDestination,
  EmbeddingLog,
  LLMLog,
  NetworkLog,
  Post,
  PostEmbedding,
  PostTranslation,
  PublishLog,
  Summary,
  SyncLog,
} from "../types"
import { request } from "./base"

export const dataApi = {
  syncMeta: () =>
    request<Record<string, { etag: string; updatedAt?: string }>>(
      "/api/v1/data/sync-meta",
    ),

  listChannels: (params?: { includeStats?: boolean }) => {
    const qs = params?.includeStats ? "?includeStats=true" : ""
    return request<(Channel & { stats?: ChannelStats })[]>(
      `/api/v1/data/channels${qs}`,
    )
  },

  upsertChannel: (id: string, channel: Partial<Channel>) =>
    request<Channel>(`/api/v1/data/channels/${id}`, {
      method: "PUT",
      body: JSON.stringify(channel),
    }),

  deleteChannel: (id: string) =>
    request<{ status: string }>(`/api/v1/data/channels/${id}`, {
      method: "DELETE",
    }),

  getChannelStats: (id: string) =>
    request<ChannelStats>(`/api/v1/data/channels/${id}/stats`),

  getPosts: (params?: {
    channelNames?: string[]
    startDate?: number
    endDate?: number
  }) => {
    const qs = new URLSearchParams()
    if (params?.channelNames?.length)
      qs.set("channelNames", params.channelNames.join(","))
    if (params?.startDate != null) qs.set("startDate", String(params.startDate))
    if (params?.endDate != null) qs.set("endDate", String(params.endDate))
    const q = qs.toString()
    return request<Post[]>(`/api/v1/data/posts${q ? `?${q}` : ""}`)
  },

  bulkUpsertPosts: (posts: Post[]) =>
    request<{ upserted: number }>("/api/v1/data/posts/bulk", {
      method: "POST",
      body: JSON.stringify(posts),
    }),

  listSummaries: () => request<Summary[]>("/api/v1/data/summaries"),

  upsertSummary: (id: string, summary: Partial<Summary>) =>
    request<Summary>(`/api/v1/data/summaries/${id}`, {
      method: "PUT",
      body: JSON.stringify(summary),
    }),

  deleteSummary: (id: string) =>
    request<{ status: string }>(`/api/v1/data/summaries/${id}`, {
      method: "DELETE",
    }),

  listBotCredentials: () =>
    request<BotCredential[]>("/api/v1/data/bot-credentials"),

  upsertBotCredential: (id: string, bot: Partial<BotCredential>) =>
    request<BotCredential>(`/api/v1/data/bot-credentials/${id}`, {
      method: "PUT",
      body: JSON.stringify(bot),
    }),

  deleteBotCredential: (id: string) =>
    request<{ status: string }>(`/api/v1/data/bot-credentials/${id}`, {
      method: "DELETE",
    }),

  migrateBotCredentials: (bots: BotCredential[]) =>
    request<{ migrated: number; ids: string[] }>(
      "/api/v1/data/bot-credentials/migrate",
      {
        method: "POST",
        body: JSON.stringify(bots),
      },
    ),

  getNetworkSettings: () =>
    request<{ key: string; value: Record<string, unknown> }>(
      "/api/v1/data/settings/network",
    ),

  putNetworkSettings: (value: Record<string, unknown>) =>
    request<{ key: string; value: Record<string, unknown> }>(
      "/api/v1/data/settings/network",
      {
        method: "PUT",
        body: JSON.stringify(value),
      },
    ),

  getSetting: (key: string) =>
    request<{ key: string; value: Record<string, unknown> }>(
      `/api/v1/data/settings/${key}`,
    ),

  putSetting: (key: string, value: Record<string, unknown>) =>
    request<{ key: string; value: Record<string, unknown> }>(
      `/api/v1/data/settings/${key}`,
      {
        method: "PUT",
        body: JSON.stringify(value),
      },
    ),

  getStats: () => request<Record<string, number>>("/api/v1/data/stats"),

  deleteLogs: (params: {
    olderThanDays?: number
    type?: "publish" | "sync" | "llm" | "embedding" | "network"
    logId?: string
    clearAll?: boolean
  }) => {
    const qs = new URLSearchParams()
    if (params.olderThanDays != null)
      qs.set("olderThanDays", String(params.olderThanDays))
    if (params.type) qs.set("type", params.type)
    if (params.logId) qs.set("logId", params.logId)
    if (params.clearAll) qs.set("clearAll", "true")
    const q = qs.toString()
    return request<{ deleted?: number; total?: number }>(
      `/api/v1/data/logs${q ? `?${q}` : ""}`,
      { method: "DELETE" },
    )
  },

  listChatDestinations: () =>
    request<ChatDestination[]>("/api/v1/data/chat-destinations"),

  upsertChatDestination: (id: string, dest: Partial<ChatDestination>) =>
    request<ChatDestination>(`/api/v1/data/chat-destinations/${id}`, {
      method: "PUT",
      body: JSON.stringify(dest),
    }),

  deleteChatDestination: (id: string) =>
    request<{ status: string }>(`/api/v1/data/chat-destinations/${id}`, {
      method: "DELETE",
    }),

  listEmbeddings: () => request<PostEmbedding[]>("/api/v1/data/embeddings"),

  upsertEmbeddings: (embeddings: PostEmbedding[]) =>
    request<{ upserted: number }>("/api/v1/data/embeddings", {
      method: "POST",
      body: JSON.stringify(embeddings),
    }),

  listTranslations: () =>
    request<PostTranslation[]>("/api/v1/data/translations"),

  upsertTranslations: (translations: PostTranslation[]) =>
    request<{ upserted: number }>("/api/v1/data/translations", {
      method: "POST",
      body: JSON.stringify(translations),
    }),

  listPublishLogs: () => request<PublishLog[]>("/api/v1/data/publish-logs"),

  createPublishLogs: (logs: PublishLog[]) =>
    request<{ upserted: number }>("/api/v1/data/publish-logs", {
      method: "POST",
      body: JSON.stringify(logs),
    }),

  listSyncLogs: () => request<SyncLog[]>("/api/v1/data/sync-logs"),

  createSyncLogs: (logs: SyncLog[]) =>
    request<{ upserted: number }>("/api/v1/data/sync-logs", {
      method: "POST",
      body: JSON.stringify(logs),
    }),

  listLLMLogs: () => request<LLMLog[]>("/api/v1/data/llm-logs"),

  createLLMLogs: (logs: LLMLog[]) =>
    request<{ upserted: number }>("/api/v1/data/llm-logs", {
      method: "POST",
      body: JSON.stringify(logs),
    }),

  listEmbeddingLogs: () =>
    request<EmbeddingLog[]>("/api/v1/data/embedding-logs"),

  createEmbeddingLogs: (logs: EmbeddingLog[]) =>
    request<{ upserted: number }>("/api/v1/data/embedding-logs", {
      method: "POST",
      body: JSON.stringify(logs),
    }),

  listNetworkLogs: () => request<NetworkLog[]>("/api/v1/data/network-logs"),

  createNetworkLogs: (logs: NetworkLog[]) =>
    request<{ upserted: number }>("/api/v1/data/network-logs", {
      method: "POST",
      body: JSON.stringify(logs),
    }),

  importData: (payload: Record<string, unknown>) =>
    request<{ imported: Record<string, number> }>("/api/v1/data/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  exportData: () => request<Record<string, unknown>>("/api/v1/data/export"),

  bulkReresolveStartIds: (body?: {
    dryRun?: boolean
    limit?: number
    channelIds?: string[]
    autoFollowOnly?: boolean
  }) =>
    request<{
      updated: number
      skipped: number
      wouldUpdate: number
      errors: { channelId: string; channelName: string; error: string }[]
    }>("/api/v1/data/channels/bulk-reresolve-start-ids", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  bulkResetSync: (body: {
    confirm: boolean
    channelIds?: string[]
    autoFollowOnly?: boolean
  }) =>
    request<{
      channelsReset: number
      postsDeleted: number
      jobId: string | null
      errors: { channelId: string; channelName: string; error: string }[]
    }>("/api/v1/data/channels/bulk-reset-sync", {
      method: "POST",
      body: JSON.stringify(body),
    }),
}
