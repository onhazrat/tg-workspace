import type {
  DiscoveryCandidate,
  DiscoveryScopeCounts,
} from "../lib/posts/discover-candidates"
import type { MediaFilterValue } from "../lib/posts/post-media"
import type {
  ForwardedFilterValue,
  MaxPostsPerChannelMode,
  PostSortOrder,
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
 * Discover and counts endpoints. The cap *mode* is not here because not every
 * consumer has one; callers that do (the feed, Discover) add it themselves via
 * `PostFeedQuery` / `DiscoverScopeQuery`.
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

/**
 * A single page of the Posts feed: the scope filters plus the per-channel cap
 * mode + seed (both used server-side for `random`), the sort order, and paging.
 */
export type PostFeedQuery = PostScopeQuery & {
  maxPerChannelMode?: MaxPostsPerChannelMode
  sort?: PostSortOrder
  seed?: number
  limit?: number
  offset?: number
}

/**
 * A scope an AI endpoint resolves into its posts block server-side. The
 * `channels` list travels at the request top level, so it is omitted here; the
 * AI paths assemble every matching post, so paging is omitted too.
 */
export type PromptScope = Omit<
  PostFeedQuery,
  "channelNames" | "limit" | "offset"
>

/**
 * A post scope shaped for a JSON request body.
 *
 * There is deliberately no query-string counterpart. Every endpoint taking a
 * post scope is a POST, because the scope carries the channel selection: at the
 * ~1,070 channels a real account holds, `?channelNames=a,b,c,...` runs to
 * roughly 13 KB and overflows what proxies and servers accept in a request line.
 *
 * Defaults are omitted rather than sent explicitly, so the body stays as small
 * as the scope actually is.
 */
export function postScopeBody(params: PostScopeQuery): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (params.channelNames?.length) body.channelNames = params.channelNames
  if (params.startDate != null) body.startDate = params.startDate
  if (params.endDate != null) body.endDate = params.endDate
  if (params.keyword?.trim()) body.keyword = params.keyword.trim()
  if (params.forwarded && params.forwarded !== "all")
    body.forwarded = params.forwarded
  if (params.media && params.media !== "all") body.media = params.media
  if (params.maxPerChannel != null && params.maxPerChannel > 0)
    body.maxPerChannel = params.maxPerChannel
  return body
}

/**
 * Inputs to a Discover run, on top of the shared post scope.
 *
 * `maxPerChannelMode` + `seed` and `postIds` are what make every scope
 * reproducible server-side: the cap reuses the feed's seeded ordering, and a
 * semantic query passes in the posts its vector search matched. Without them
 * these two cases needed a duplicate client-side aggregation (IDEA-011 D14).
 */
export type DiscoverScopeQuery = PostScopeQuery & {
  signals?: string[]
  maxPerChannelMode?: MaxPostsPerChannelMode
  seed?: number
  /** Omit for no restriction; `[]` means the search matched nothing. */
  postIds?: { channelName: string; postId: number }[]
}

function discoverScopeBody(
  params: DiscoverScopeQuery,
): Record<string, unknown> {
  const body = postScopeBody(params)
  // `channelNames` is required server-side, so send it even when empty rather
  // than letting `postScopeBody`'s omit-empty rule drop it into a 422.
  body.channelNames = params.channelNames ?? []
  if (params.signals) body.signals = params.signals
  if (params.maxPerChannelMode)
    body.maxPerChannelMode = params.maxPerChannelMode
  if (params.seed != null) body.seed = params.seed
  // Sent even when empty: `[]` and "absent" mean different things here.
  if (params.postIds != null) body.postIds = params.postIds
  return body
}

/**
 * The scope a saved report was generated for.
 *
 * A frozen copy of the inputs, not a pointer to live state — this is what the
 * scope card renders, so it keeps describing where the numbers came from after
 * the user changes their selection.
 */
export type DiscoverReportScope = {
  channels: string[]
  startDate: number
  endDate: number
  signals: string[]
  keyword: string | null
  forwarded: ForwardedFilterValue
  media: MediaFilterValue
  maxPerChannel: number
  maxPerChannelMode: MaxPostsPerChannelMode
  seed: number
  /** Posts the scope was explicitly restricted to; `null` when unrestricted. */
  scopedPostCount: number | null
}

/** List-view projection: metadata only, never the candidate rows. */
export type DiscoverReportSummary = {
  id: string
  scope: DiscoverReportScope
  scopeCounts: DiscoveryScopeCounts
  postsInScope: number
  timestamp: number
  candidateCount: number
}

/** A saved report with its candidates. `isFollowed` is resolved live per read. */
export type DiscoverReport = DiscoverReportSummary & {
  candidates: DiscoveryCandidate[]
}

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
    const body: Record<string, unknown> = {}
    if (params?.channelNames?.length) body.channelNames = params.channelNames
    if (params?.startDate != null) body.startDate = params.startDate
    if (params?.endDate != null) body.endDate = params.endDate
    if (params?.limit != null) body.limit = params.limit
    if (params?.offset != null) body.offset = params.offset
    return request<Post[]>("/api/v1/data/posts", {
      method: "POST",
      body: JSON.stringify(body),
    })
  },

  /**
   * One page of the server-side Posts feed. The backend applies the
   * keyword/forwarded/media filters, the per-channel cap (`latest` or a
   * deterministic seeded `random`), and the sort — so the browser fetches only
   * `limit` rows per page instead of a channel's whole history.
   */
  getPostsFeed: (params: PostFeedQuery) => {
    const body = postScopeBody(params)
    // The cap mode and seed only mean anything alongside a cap, so they follow
    // it — exactly as the query-string builder gated them.
    if (params.maxPerChannel != null && params.maxPerChannel > 0) {
      if (params.maxPerChannelMode)
        body.maxPerChannelMode = params.maxPerChannelMode
      if (params.seed != null) body.seed = params.seed
    }
    if (params.sort) body.sort = params.sort
    if (params.limit != null) body.limit = params.limit
    if (params.offset != null) body.offset = params.offset
    return request<Post[]>("/api/v1/data/posts", {
      method: "POST",
      body: JSON.stringify(body),
    })
  },

  /** Resolve specific posts by natural key. Batch capped server-side at 200. */
  lookupPosts: (refs: { channelName: string; postId: number }[]) =>
    request<Post[]>("/api/v1/data/posts/lookup", {
      method: "POST",
      body: JSON.stringify({ posts: refs }),
    }),

  /**
   * Discover aggregation without saving a report.
   *
   * The only implementation of the counting rules — the browser no longer has
   * a copy. Covers every scope: keyword / forwarded / media, the per-channel
   * cap in either mode, and an explicit `postIds` set for a semantic query.
   */
  getDiscoverCandidates: (params: DiscoverScopeQuery) => {
    const body = discoverScopeBody(params)
    return request<{
      candidates: DiscoveryCandidate[]
      scopeCounts: DiscoveryScopeCounts
      /** Posts surviving the scope filters + cap; the client's `filteredPosts.length`. */
      postsInScope: number
    }>("/api/v1/data/discover/candidates", {
      method: "POST",
      body: JSON.stringify(body),
    })
  },

  /**
   * Generate a Discover report and save it.
   *
   * Same inputs as `getDiscoverCandidates`, but the result is persisted with a
   * snapshot of the scope it was generated for. Changing the channel selection
   * or the Posts-tab filters afterwards produces a *new* report rather than
   * altering this one — see IDEA-011 W1.
   */
  createDiscoverReport: (params: DiscoverScopeQuery) => {
    const body = discoverScopeBody(params)
    return request<DiscoverReport>("/api/v1/data/discover/reports", {
      method: "POST",
      body: JSON.stringify(body),
    })
  },

  /** Saved reports, newest first, without their candidate rows. */
  listDiscoverReports: (params?: {
    limit?: number
    offset?: number
    search?: string
  }) => {
    const qs = new URLSearchParams()
    if (params?.limit != null) qs.set("limit", String(params.limit))
    if (params?.offset != null) qs.set("offset", String(params.offset))
    if (params?.search) qs.set("search", params.search)
    const suffix = qs.toString() ? `?${qs}` : ""
    return request<DiscoverReportSummary[]>(
      `/api/v1/data/discover/reports${suffix}`,
    )
  },

  /** The most recent saved report, or null when none has been generated. */
  getLatestDiscoverReport: () =>
    request<DiscoverReport | null>("/api/v1/data/discover/reports/latest"),

  /** A saved report with every candidate, `isFollowed` resolved live. */
  getDiscoverReport: (reportId: string) =>
    request<DiscoverReport>(
      `/api/v1/data/discover/reports/${encodeURIComponent(reportId)}`,
    ),

  /** Dismissed candidates, newest first. */
  listDiscoverIgnored: () =>
    request<{ handle: string; reason: string | null; createdAt: number }[]>(
      "/api/v1/data/discover/ignored",
    ),

  /** Dismiss candidates so later reports stop re-surfacing them. Idempotent. */
  ignoreDiscoverChannels: (handles: string[], reason?: string) =>
    request<{ ignored: string[] }>("/api/v1/data/discover/ignored", {
      method: "POST",
      body: JSON.stringify(reason ? { handles, reason } : { handles }),
    }),

  /** Undo a dismissal. */
  unignoreDiscoverChannels: (handles: string[]) =>
    request<{ removed: string[] }>("/api/v1/data/discover/ignored", {
      method: "DELETE",
      body: JSON.stringify({ handles }),
    }),

  deleteDiscoverReport: (reportId: string) =>
    request<{ status: string }>(
      `/api/v1/data/discover/reports/${encodeURIComponent(reportId)}`,
      { method: "DELETE" },
    ),

  /**
   * Per-channel post counts for a filtered scope (SQL GROUP BY).
   *
   * POSTed rather than GETed: the scope carries the channel selection, which can
   * be the whole account. As a query string that reached ~700 chars at 43
   * channels and would have run to roughly 13 KB at the ~1,070 channels a real
   * account holds — past what proxies and servers accept in a request line.
   */
  getPostsCounts: (params: PostScopeQuery) =>
    request<Record<string, number>>("/api/v1/data/posts/counts", {
      method: "POST",
      body: JSON.stringify(postScopeBody(params)),
    }),

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
