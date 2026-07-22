import type {
  DiscoveryCandidate,
  DiscoveryScopeCounts,
} from "../lib/posts/discover-candidates"
import type { MediaFilterValue } from "../lib/posts/post-media"
import type {
  ForwardedFilterValue,
  MaxPostsPerChannelMode,
} from "../lib/posts/post-view"
import type {
  BotCredential,
  Channel,
  ChannelSettingGroup,
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
  SummaryListItem,
  SyncLog,
  TagRun,
  TagRunSummary,
} from "../types"
import { request, sseJsonStream } from "./base"

export type DiscoveredViaPayload = {
  channelName: string
  postId: number
  timestamp: number
}

/**
 * The Posts-tab view state that maps onto server-side filtering, shared by the
 * Discover and counts endpoints. `maxPerChannel` is only sent for the `latest`
 * cap mode — `random` is browser-only, so those callers omit it and fall back
 * to the client computation.
 */
export type PostScopeQuery = {
  channelNames?: string[]
  startDate?: number
  endDate?: number
  keyword?: string
  forwarded?: ForwardedFilterValue
  media?: MediaFilterValue
  maxPerChannel?: number
}

function postScopeParams(params: PostScopeQuery): URLSearchParams {
  const qs = new URLSearchParams()
  if (params.channelNames?.length)
    qs.set("channelNames", params.channelNames.join(","))
  if (params.startDate != null) qs.set("startDate", String(params.startDate))
  if (params.endDate != null) qs.set("endDate", String(params.endDate))
  if (params.keyword?.trim()) qs.set("keyword", params.keyword.trim())
  if (params.forwarded && params.forwarded !== "all")
    qs.set("forwarded", params.forwarded)
  if (params.media && params.media !== "all") qs.set("media", params.media)
  if (params.maxPerChannel != null && params.maxPerChannel > 0)
    qs.set("maxPerChannel", String(params.maxPerChannel))
  return qs
}

/** Cap modes whose per-channel selection can be reproduced server-side. */
export const SERVER_REPRODUCIBLE_CAP_MODES: ReadonlySet<MaxPostsPerChannelMode> =
  new Set<MaxPostsPerChannelMode>(["latest"])

export type BulkFollowChannelInput = {
  name: string
  discoveredVia?: DiscoveredViaPayload
}

export type BulkFollowRequest = {
  channels: BulkFollowChannelInput[]
  proxyEnabled?: boolean
  proxies?: string[]
  torAutoRotate?: boolean
  torRotationThreshold?: number
}

export type FollowChannelResultStatus =
  | "pending"
  | "running"
  | "added"
  | "unavailable"
  | "skipped"
  | "error"
  | "cancelled"

export type FollowChannelResult = {
  name: string
  status: FollowChannelResultStatus
  reason?: string
  error?: string
}

export type FollowJobStatus = {
  followJobId: string
  status: string
  source: string
  total: number
  completed: number
  added: number
  skipped: number
  unavailable: number
  failed: number
  results: FollowChannelResult[]
  syncJobId: string | null
  createdAt: number
  finishedAt: number | null
}

const CHANNEL_INHERITED_WRITE_FIELDS = [
  "regularSyncEnabled",
  "dynamicSyncEnabled",
  "autoSyncIntervalMinutes",
  "dynamicSyncExpectedPosts",
  "autoFollowForwarded",
  "isFrozen",
  "isUnavailableOnWebView",
  "includeInSyncAll",
  "includeInBulkSync",
  "allowIndividualSync",
  "resetSyncEnabled",
  "settingGroupId",
  "settingGroupName",
  "telegramChatId",
] as const satisfies readonly (keyof Channel)[]

export function channelWritePayload(
  channel: Partial<Channel>,
): Partial<Channel> {
  const payload = { ...channel }
  for (const key of CHANNEL_INHERITED_WRITE_FIELDS) {
    delete payload[key]
  }
  return payload
}

export interface BulkSyncSettingsPatchBody {
  channelIds: string[] | null
  regularSyncEnabled?: boolean
  dynamicSyncEnabled?: boolean
  autoSyncIntervalMinutes?: number
  dynamicSyncExpectedPosts?: number
}

export interface SettingGroupWriteBody {
  name?: string
  regularSyncEnabled?: boolean
  dynamicSyncEnabled?: boolean
  autoSyncIntervalMinutes?: number
  dynamicSyncExpectedPosts?: number
  autoFollowForwarded?: boolean
  isFrozen?: boolean
  isUnavailableOnWebView?: boolean
  includeInSyncAll?: boolean
  includeInBulkSync?: boolean
  allowIndividualSync?: boolean
  resetSyncEnabled?: boolean
}

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
      body: JSON.stringify(channelWritePayload(channel)),
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
    limit?: number
    offset?: number
  }) => {
    const qs = new URLSearchParams()
    if (params?.channelNames?.length)
      qs.set("channelNames", params.channelNames.join(","))
    if (params?.startDate != null) qs.set("startDate", String(params.startDate))
    if (params?.endDate != null) qs.set("endDate", String(params.endDate))
    if (params?.limit != null) qs.set("limit", String(params.limit))
    if (params?.offset != null) qs.set("offset", String(params.offset))
    const q = qs.toString()
    return request<Post[]>(`/api/v1/data/posts${q ? `?${q}` : ""}`)
  },

  /** Resolve specific posts by natural key. Batch capped server-side at 200. */
  lookupPosts: (refs: { channelName: string; postId: number }[]) =>
    request<Post[]>("/api/v1/data/posts/lookup", {
      method: "POST",
      body: JSON.stringify({ posts: refs }),
    }),

  /**
   * Server-side Discover aggregation. Mirrors `computeDiscoveryCandidates`'s
   * output (minus the client-only `emptyReason`) over the same filtered scope:
   * keyword / forwarded / media, then the `latest` per-channel cap. Callers
   * keep the client path when a semantic query or a `random` cap is active —
   * neither is reproducible server-side.
   */
  getDiscoverCandidates: (params: PostScopeQuery & { signals?: string[] }) => {
    const qs = postScopeParams(params)
    if (params.signals) qs.set("signals", params.signals.join(","))
    return request<{
      candidates: DiscoveryCandidate[]
      scopeCounts: DiscoveryScopeCounts
      /** Posts surviving the scope filters + cap; the client's `filteredPosts.length`. */
      postsInScope: number
    }>(`/api/v1/data/discover/candidates?${qs.toString()}`)
  },

  /** Per-channel post counts for a filtered scope (SQL GROUP BY). */
  getPostsCounts: (params: PostScopeQuery) =>
    request<Record<string, number>>(
      `/api/v1/data/posts/counts?${postScopeParams(params).toString()}`,
    ),

  getTranslation: (channelName: string, postId: number, language: string) => {
    const qs = new URLSearchParams({
      channelName,
      postId: String(postId),
      language,
    })
    return request<PostTranslation | null>(
      `/api/v1/data/translations/one?${qs.toString()}`,
    )
  },

  bulkUpsertPosts: (posts: Post[]) =>
    request<{ upserted: number }>("/api/v1/data/posts/bulk", {
      method: "POST",
      body: JSON.stringify(posts),
    }),

  /**
   * List projection — metadata only. `citedPosts`, `promptText` and
   * `chatMessages` come from `getSummary`. `search` matches prompt bodies
   * server-side so they stay findable without being shipped.
   */
  listSummaries: (params?: {
    search?: string
    limit?: number
    offset?: number
  }) => {
    const qs = new URLSearchParams()
    if (params?.search) qs.set("search", params.search)
    if (params?.limit != null) qs.set("limit", String(params.limit))
    if (params?.offset != null) qs.set("offset", String(params.offset))
    const q = qs.toString()
    return request<SummaryListItem[]>(
      `/api/v1/data/summaries${q ? `?${q}` : ""}`,
    )
  },

  getSummary: (id: string) => request<Summary>(`/api/v1/data/summaries/${id}`),

  /**
   * List projection — carries metadata only. `promptText`, `responseText`,
   * `suggestions` and `allTagsSnapshot` come from `getTagRun`.
   */
  listTagRuns: () => request<TagRunSummary[]>("/api/v1/data/tag-runs"),

  getTagRun: (id: string) => request<TagRun>(`/api/v1/data/tag-runs/${id}`),

  upsertTagRun: (id: string, run: Partial<TagRun>) =>
    request<TagRun>(`/api/v1/data/tag-runs/${id}`, {
      method: "PUT",
      body: JSON.stringify(run),
    }),

  deleteTagRun: (id: string) =>
    request<{ status: string }>(`/api/v1/data/tag-runs/${id}`, {
      method: "DELETE",
    }),

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

  getTableSizes: () =>
    request<{ name: string; count: number; size: number }[]>(
      "/api/v1/data/table-sizes",
    ),

  clearServerTable: (name: string) =>
    request<{ deleted: number }>(
      `/api/v1/data/tables/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),

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

  bulkSyncSettings: (body: BulkSyncSettingsPatchBody) =>
    request<{
      updated: number
      errors?: { channelId: string; channelName: string; error: string }[]
    }>("/api/v1/data/channels/bulk-sync-settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listSettingGroups: () =>
    request<ChannelSettingGroup[]>("/api/v1/data/setting-groups"),

  createSettingGroup: (body: SettingGroupWriteBody) =>
    request<ChannelSettingGroup>("/api/v1/data/setting-groups", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateSettingGroup: (id: string, body: SettingGroupWriteBody) =>
    request<ChannelSettingGroup>(`/api/v1/data/setting-groups/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteSettingGroup: (id: string) =>
    request<{ status: string }>(`/api/v1/data/setting-groups/${id}`, {
      method: "DELETE",
    }),

  bulkAssignSettingGroup: (body: {
    channelIds: string[]
    settingGroupId: string
  }) =>
    request<{ updated: number; settingGroupId: string }>(
      "/api/v1/data/channels/bulk-setting-group",
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),

  bulkUpdateChannelTags: (body: {
    updates: { channelId: string; tags: Channel["tags"] }[]
  }) =>
    request<{ updated: number; channels: Channel[] }>(
      "/api/v1/data/channels/bulk-tags",
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),

  bulkFollowChannels: (body: BulkFollowRequest) =>
    request<{ followJobId: string }>("/api/v1/data/channels/bulk-follow", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getFollowJobStatus: (followJobId: string) =>
    request<FollowJobStatus>(
      `/api/v1/data/channels/bulk-follow/${followJobId}`,
    ),
}

/** Subscribe to bulk-follow job progress via SSE (full status snapshots). */
export async function* streamFollowJobEvents(
  followJobId: string,
  signal?: AbortSignal,
): AsyncGenerator<FollowJobStatus> {
  yield* sseJsonStream<FollowJobStatus>(
    `/api/v1/data/channels/bulk-follow/${followJobId}/events`,
    { signal },
  )
}
