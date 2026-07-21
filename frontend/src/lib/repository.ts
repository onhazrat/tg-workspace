/**
 * Hybrid sync: API-first with IndexedDB cache (read-through).
 * On API write failure: fall back to IndexedDB and notify via onWriteFallback.
 */

import { api } from "@/api"
import { env } from "@/lib/env"
import type {
  BotCredential,
  Channel,
  ChannelStats,
  ChatDestination,
  DBStats,
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
import { stripToken } from "./botCredential"
import * as cache from "./cache"
import {
  filterSummariesByTextQuery,
  toSummaryListItem,
} from "./summary-projection"

let syncMeta: Record<string, { etag: string }> = {}
let syncMetaFetchedAt = 0

type WriteFallbackHandler = (resource: string, error: unknown) => void
let onWriteFallback: WriteFallbackHandler | null = null

export function setWriteFallbackHandler(
  handler: WriteFallbackHandler | null,
): void {
  onWriteFallback = handler
}

export function getSyncMeta(): Record<string, { etag: string }> {
  return { ...syncMeta }
}

export async function refreshSyncMeta(force = false): Promise<void> {
  const now = Date.now()
  if (!force && now - syncMetaFetchedAt < env.syncMetaMinIntervalMs) {
    return
  }
  try {
    syncMeta = await api.syncMeta()
    syncMetaFetchedAt = now
  } catch {
    /* server unavailable — use cache only */
  }
}

export function invalidateSyncMetaCache(): void {
  syncMetaFetchedAt = 0
}

async function isResourceStale(resource: string): Promise<boolean> {
  await refreshSyncMeta()
  const remote = syncMeta[resource]?.etag
  if (!remote) return false
  const localKey = `sync_etag_${resource}`
  const local = localStorage.getItem(localKey)
  return local !== remote
}

function markResourceSynced(resource: string): void {
  const remote = syncMeta[resource]?.etag
  if (remote) {
    localStorage.setItem(`sync_etag_${resource}`, remote)
  }
}

async function apiWrite<T>(
  resource: string,
  apiFn: () => Promise<T>,
  cacheFn: () => Promise<void>,
): Promise<T> {
  try {
    const result = await apiFn()
    await cacheFn()
    await refreshSyncMeta(true)
    markResourceSynced(resource)
    return result
  } catch (error) {
    await cacheFn()
    onWriteFallback?.(resource, error)
    throw error
  }
}

/**
 * In-flight request de-duplication.
 *
 * Staleness is tracked as a single global etag per resource with no
 * coordination between callers, so concurrent readers of the same resource
 * each fired their own identical request. Posts were worst: six direct call
 * sites and no TanStack Query coverage. Callers arriving while a request is
 * outstanding now await that same promise.
 *
 * Entries are removed once settled, so this is a de-duplicator, not a cache —
 * it never serves a stale value to a later caller.
 */
const inFlight = new Map<string, Promise<unknown>>()

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>

  const promise = fn().finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}

/** Test seam: drop any outstanding de-dup entries. */
export function resetInFlight(): void {
  inFlight.clear()
}

async function listWithStaleCheck<T>(
  resource: string,
  fetchRemote: () => Promise<T[]>,
  persistRemote: (items: T[]) => Promise<void>,
  readCache: () => Promise<T[]>,
): Promise<T[]> {
  if (await isResourceStale(resource)) {
    try {
      const remote = await fetchRemote()
      await persistRemote(remote)
      markResourceSynced(resource)
      return remote
    } catch {
      /* fall through to cache */
    }
  }
  return readCache()
}

// --- channels ---

export async function listChannels(): Promise<Channel[]> {
  const { channels } = await listChannelsWithStats()
  return channels
}

/** Single round-trip for channels + per-channel stats (avoids N+1). */
export async function listChannelsWithStats(): Promise<{
  channels: Channel[]
  stats: Record<string, ChannelStats>
}> {
  const persist = async (rows: (Channel & { stats?: ChannelStats })[]) => {
    const channels: Channel[] = []
    const stats: Record<string, ChannelStats> = {}
    for (const row of rows) {
      const { stats: channelStats, ...channel } = row
      channels.push(channel)
      if (channelStats) stats[channel.name] = channelStats
      await cache.saveChannel(channel)
    }
    return { channels, stats }
  }

  if (await isResourceStale("channels")) {
    try {
      const remote = await api.listChannels({ includeStats: true })
      const result = await persist(remote)
      markResourceSynced("channels")
      return result
    } catch {
      /* fall through to cache */
    }
  }
  const cached = await cache.getChannels()
  const stats: Record<string, ChannelStats> = {}
  for (const ch of cached) {
    const s = await cache.getChannelStats(ch.name)
    if (s) stats[ch.name] = s
  }
  return { channels: cached, stats }
}

export async function upsertChannel(channel: Channel): Promise<Channel> {
  return apiWrite(
    "channels",
    () => api.upsertChannel(channel.id, channel),
    () => cache.saveChannel(channel),
  )
}

export async function bulkSyncChannelSettings(body: {
  channelIds: string[] | null
  regularSyncEnabled?: boolean
  dynamicSyncEnabled?: boolean
  autoSyncIntervalMinutes?: number
  dynamicSyncExpectedPosts?: number
}): Promise<{ updated: number }> {
  const result = await api.bulkSyncSettings(body)
  await refreshSyncMeta(true)
  markResourceSynced("channels")
  return { updated: result.updated }
}

export async function bulkUpdateChannelTags(
  updates: { channelId: string; tags: Channel["tags"] }[],
): Promise<{ updated: number; channels: Channel[] }> {
  try {
    const result = await api.bulkUpdateChannelTags({ updates })
    for (const channel of result.channels) {
      await cache.saveChannel(channel)
    }
    await refreshSyncMeta(true)
    markResourceSynced("channels")
    return result
  } catch (error) {
    onWriteFallback?.("channels", error)
    throw error
  }
}

export async function deleteChannel(id: string): Promise<void> {
  try {
    await api.deleteChannel(id)
    await cache.deleteChannel(id)
    await refreshSyncMeta(true)
    markResourceSynced("channels")
  } catch (error) {
    await cache.deleteChannel(id)
    onWriteFallback?.("channels", error)
    throw error
  }
}

export async function getChannelStats(
  channelId: string,
  channelName: string,
): Promise<ChannelStats | null> {
  try {
    return await api.getChannelStats(channelId)
  } catch {
    return cache.getChannelStats(channelName)
  }
}

// --- posts ---

/** Server-side cap; see MAX_POST_PAGE_SIZE in backend/app/services/posts.py. */
const POST_PAGE_SIZE = 5000

/**
 * Safety valve on the paging loop below. At 5000 rows a page this is 5M posts
 * — far past any legitimate view. Hitting it means a caller asked for a range
 * it should have narrowed, so we surface that rather than spin.
 */
const MAX_POST_PAGES = 1000

/**
 * Fetch every post in a range, paging through the now-bounded `GET /posts`.
 *
 * `GET /posts` used to return the whole matching set in one unbounded
 * response. Rather than let existing callers silently receive only the first
 * page, this pages to exhaustion — the transfer is the same size, but the
 * backend no longer materialises it all at once, which is what OOM-killed the
 * worker.
 *
 * Callers that only need a bounded sample should pass `limit` instead of
 * paging the whole range.
 */
async function fetchAllPosts(
  channelNames: string[],
  startDate: number,
  endDate: number,
): Promise<Post[]> {
  const all: Post[] = []
  for (let page = 0; page < MAX_POST_PAGES; page++) {
    const batch = await api.getPosts({
      channelNames,
      startDate,
      endDate,
      limit: POST_PAGE_SIZE,
      offset: page * POST_PAGE_SIZE,
    })
    all.push(...batch)
    if (batch.length < POST_PAGE_SIZE) return all
  }
  throw new Error(
    `getPostsByDateRange exceeded ${MAX_POST_PAGES} pages ` +
      `(${MAX_POST_PAGES * POST_PAGE_SIZE} posts) for ` +
      `${channelNames.length} channel(s) — narrow the date range`,
  )
}

export async function getPostsByDateRange(
  channelNames: string[],
  startDate: number,
  endDate: number,
  options: { limit?: number } = {},
): Promise<Post[]> {
  const { limit } = options
  const key = `posts:${channelNames.join(",")}:${startDate}:${endDate}:${limit ?? "all"}`
  return singleFlight(key, async () => {
    if (await isResourceStale("posts")) {
      try {
        const remote =
          limit != null
            ? await api.getPosts({ channelNames, startDate, endDate, limit })
            : await fetchAllPosts(channelNames, startDate, endDate)
        await cache.savePosts(remote)
        // A bounded read is a sample, not the full resource — marking the
        // resource synced off one page would suppress later full fetches.
        if (limit == null) markResourceSynced("posts")
        return remote
      } catch {
        /* fall through */
      }
    }
    const cached = await cache.getPostsByDateRange(
      channelNames,
      startDate,
      endDate,
    )
    return limit != null ? cached.slice(0, limit) : cached
  })
}

export async function getPost(
  channelName: string,
  id: number,
): Promise<Post | undefined> {
  const [match] = await lookupPosts([{ channelName, postId: id }])
  if (match) return match
  return cache.getPost(channelName, id)
}

/** Must not exceed MAX_POST_LOOKUP_BATCH in backend/app/services/posts.py. */
const POST_LOOKUP_BATCH = 200

/**
 * Resolve specific posts by natural key, batched into one request per 200.
 *
 * Replaces the previous `getPost`, which fetched a channel's entire history
 * to return a single row — and was called in a loop by RAG context assembly
 * and once per citation hover.
 */
export async function lookupPosts(
  refs: { channelName: string; postId: number }[],
): Promise<Post[]> {
  if (refs.length === 0) return []
  const key = `posts:lookup:${refs
    .map((r) => `${r.channelName}#${r.postId}`)
    .sort()
    .join(",")}`
  return singleFlight(key, async () => {
    try {
      const batches: Post[][] = []
      for (let i = 0; i < refs.length; i += POST_LOOKUP_BATCH) {
        batches.push(
          await api.lookupPosts(refs.slice(i, i + POST_LOOKUP_BATCH)),
        )
      }
      const found = batches.flat()
      if (found.length > 0) await cache.savePosts(found)
      return found
    } catch {
      const cached = await Promise.all(
        refs.map((r) => cache.getPost(r.channelName, r.postId)),
      )
      return cached.filter((p): p is Post => p !== undefined)
    }
  })
}

export async function bulkUpsertPosts(posts: Post[]): Promise<void> {
  await apiWrite(
    "posts",
    () => api.bulkUpsertPosts(posts),
    () => cache.savePosts(posts),
  )
}

export async function getPostsWithoutEmbeddings(
  limit: number = 50,
): Promise<Post[]> {
  return cache.getPostsWithoutEmbeddings(limit)
}

export async function clearChannelPosts(channelName: string): Promise<void> {
  await cache.clearChannelPosts(channelName)
}

export async function deleteOldPosts(days: number): Promise<number> {
  return cache.deleteOldPosts(days)
}

// --- summaries ---

/**
 * Metadata-only list. Use `getSummary` for citedPosts/promptText/chatMessages.
 *
 * `search` is passed to the server so prompt bodies stay searchable — they are
 * ~94% of what this endpoint used to return and are no longer shipped.
 */
export async function listSummaries(
  options: { search?: string } = {},
): Promise<SummaryListItem[]> {
  const { search } = options
  return singleFlight(`summaries:${search ?? ""}`, async () => {
    // A search is a server-side query, not a mirror of the whole resource:
    // going through the etag gate would answer from an unfiltered cache.
    if (search) {
      try {
        return await api.listSummaries({ search })
      } catch {
        const cached = await cache.getSummaries()
        return filterSummariesByTextQuery(cached, search).map(toSummaryListItem)
      }
    }

    if (await isResourceStale("summaries")) {
      try {
        const remote = await api.listSummaries()
        for (const s of remote) {
          await cache.saveSummaryListItem(s)
        }
        markResourceSynced("summaries")
        return remote
      } catch {
        /* fall through */
      }
    }
    return (await cache.getSummaries()).map(toSummaryListItem)
  })
}

/** One summary in full, including the heavy fields. */
export async function getSummary(id: string): Promise<Summary | undefined> {
  return singleFlight(`summary:${id}`, async () => {
    try {
      const remote = await api.getSummary(id)
      await cache.saveSummary(remote)
      return remote
    } catch {
      return (await cache.getSummaries()).find((s) => s.id === id)
    }
  })
}

export async function saveSummary(summary: Summary): Promise<Summary> {
  return apiWrite(
    "summaries",
    () => api.upsertSummary(summary.id, summary),
    () => cache.saveSummary(summary),
  )
}

export async function deleteSummary(id: string): Promise<void> {
  try {
    await api.deleteSummary(id)
    await cache.deleteSummary(id)
    await refreshSyncMeta(true)
    markResourceSynced("summaries")
  } catch (error) {
    await cache.deleteSummary(id)
    onWriteFallback?.("summaries", error)
    throw error
  }
}

/** Metadata-only list; use `getTagRun` for prompt/response/suggestions. */
export async function listTagRuns(): Promise<TagRunSummary[]> {
  try {
    return await api.listTagRuns()
  } catch {
    return []
  }
}

/** One run in full, including the heavy prompt and response fields. */
export async function getTagRun(id: string): Promise<TagRun | undefined> {
  return singleFlight(`tagRun:${id}`, async () => {
    try {
      return await api.getTagRun(id)
    } catch {
      return undefined
    }
  })
}

export async function upsertTagRun(run: TagRun): Promise<TagRun> {
  return api.upsertTagRun(run.id, run)
}

export async function deleteTagRun(id: string): Promise<void> {
  await api.deleteTagRun(id)
}

// --- bot credentials ---

export async function listBotCredentials(): Promise<BotCredential[]> {
  if (await isResourceStale("bot_credentials")) {
    try {
      const remote = await api.listBotCredentials()
      for (const b of remote) {
        await cache.saveBotCredential(stripToken(b))
      }
      markResourceSynced("bot_credentials")
      return remote.map(stripToken)
    } catch {
      /* fall through */
    }
  }
  const cached = await cache.getBotCredentials()
  return cached.map(stripToken)
}

export async function saveBotCredential(
  bot: BotCredential,
): Promise<BotCredential> {
  const payload: BotCredential = { ...bot }
  const saved = await apiWrite(
    "bot_credentials",
    () => api.upsertBotCredential(bot.id, payload),
    () => cache.saveBotCredential(stripToken(bot)),
  )
  return stripToken(saved)
}

export async function deleteBotCredential(id: string): Promise<void> {
  try {
    await api.deleteBotCredential(id)
    await cache.deleteBotCredential(id)
    await refreshSyncMeta(true)
    markResourceSynced("bot_credentials")
  } catch (error) {
    await cache.deleteBotCredential(id)
    onWriteFallback?.("bot_credentials", error)
    throw error
  }
}

// --- chat destinations ---

export async function listChatDestinations(): Promise<ChatDestination[]> {
  if (await isResourceStale("chat_destinations")) {
    try {
      const remote = await api.listChatDestinations()
      for (const d of remote) {
        await cache.saveChatDestination(d)
      }
      markResourceSynced("chat_destinations")
      return remote
    } catch {
      /* fall through */
    }
  }
  return cache.getChatDestinations()
}

export async function saveChatDestination(
  dest: ChatDestination,
): Promise<ChatDestination> {
  return apiWrite(
    "chat_destinations",
    () => api.upsertChatDestination(dest.id, dest),
    () => cache.saveChatDestination(dest),
  )
}

export async function deleteChatDestination(id: string): Promise<void> {
  try {
    await api.deleteChatDestination(id)
    await cache.deleteChatDestination(id)
    await refreshSyncMeta(true)
    markResourceSynced("chat_destinations")
  } catch (error) {
    await cache.deleteChatDestination(id)
    onWriteFallback?.("chat_destinations", error)
    throw error
  }
}

// --- embeddings & translations ---

export async function listEmbeddings(): Promise<PostEmbedding[]> {
  if (await isResourceStale("embeddings")) {
    try {
      const remote = await api.listEmbeddings()
      await cache.saveEmbeddings(remote)
      markResourceSynced("embeddings")
      return remote
    } catch {
      /* fall through */
    }
  }
  return cache.getAllEmbeddings()
}

export async function saveEmbeddings(
  embeddings: PostEmbedding[],
): Promise<void> {
  await apiWrite(
    "embeddings",
    () => api.upsertEmbeddings(embeddings),
    () => cache.saveEmbeddings(embeddings),
  )
}

/**
 * Read one translation.
 *
 * Previously a full-table download per read, gated on a resource etag — and
 * because `saveTranslation` bumps that etag, every save forced the next read
 * to re-download every translation in the database. Now a single-row request
 * with the result cached locally; the cache answers when the server is
 * unreachable.
 */
export async function getTranslation(
  channelName: string,
  postId: number,
  language: string,
): Promise<PostTranslation | undefined> {
  const key = `translation:${channelName}#${postId}#${language}`
  return singleFlight(key, async () => {
    try {
      const remote = await api.getTranslation(channelName, postId, language)
      if (remote) {
        await cache.saveTranslation(remote)
        return remote
      }
      // A confirmed absence — do not fall back to a stale cached row.
      return undefined
    } catch {
      return cache.getTranslation(channelName, postId, language)
    }
  })
}

export async function saveTranslation(
  translation: PostTranslation,
): Promise<void> {
  await apiWrite(
    "translations",
    () => api.upsertTranslations([translation]),
    () => cache.saveTranslation(translation),
  )
}

// --- logs (reads API-first, deletes cache-only until server endpoints exist) ---

export async function listPublishLogs(): Promise<PublishLog[]> {
  return listWithStaleCheck(
    "publish_logs",
    () => api.listPublishLogs(),
    async (logs) => {
      for (const log of logs) await cache.savePublishLog(log)
    },
    () => cache.getPublishLogs(),
  )
}

export async function listSyncLogs(): Promise<SyncLog[]> {
  return listWithStaleCheck(
    "sync_logs",
    () => api.listSyncLogs(),
    async (logs) => {
      for (const log of logs) await cache.saveSyncLog(log)
    },
    () => cache.getSyncLogs(),
  )
}

export async function listLLMLogs(): Promise<LLMLog[]> {
  return listWithStaleCheck(
    "llm_logs",
    () => api.listLLMLogs(),
    async (logs) => {
      for (const log of logs) await cache.saveLLMLog(log)
    },
    () => cache.getLLMLogs(),
  )
}

export async function listEmbeddingLogs(): Promise<EmbeddingLog[]> {
  return listWithStaleCheck(
    "embedding_logs",
    () => api.listEmbeddingLogs(),
    async (logs) => {
      for (const log of logs) await cache.saveEmbeddingLog(log)
    },
    () => cache.getEmbeddingLogs(),
  )
}

export async function listNetworkLogs(): Promise<NetworkLog[]> {
  return listWithStaleCheck(
    "network_logs",
    () => api.listNetworkLogs(),
    async (logs) => {
      for (const log of logs) await cache.saveNetworkLog(log)
    },
    () => cache.getNetworkLogs(),
  )
}

export async function savePublishLog(log: PublishLog): Promise<void> {
  await apiWrite(
    "publish_logs",
    () => api.createPublishLogs([log]),
    () => cache.savePublishLog(log),
  )
}

export async function saveSyncLog(log: SyncLog): Promise<void> {
  await apiWrite(
    "sync_logs",
    () => api.createSyncLogs([log]),
    () => cache.saveSyncLog(log),
  )
}

export async function saveLLMLog(log: LLMLog): Promise<void> {
  await apiWrite(
    "llm_logs",
    () => api.createLLMLogs([log]),
    () => cache.saveLLMLog(log),
  )
}

export async function saveEmbeddingLog(log: EmbeddingLog): Promise<void> {
  await apiWrite(
    "embedding_logs",
    () => api.createEmbeddingLogs([log]),
    () => cache.saveEmbeddingLog(log),
  )
}

export async function saveNetworkLog(log: NetworkLog): Promise<void> {
  await apiWrite(
    "network_logs",
    () => api.createNetworkLogs([log]),
    () => cache.saveNetworkLog(log),
  )
}

async function deleteLogOnServer(
  type: "publish" | "sync" | "llm" | "embedding" | "network",
  opts: { logId?: string; clearAll?: boolean; olderThanDays?: number },
): Promise<void> {
  try {
    await api.deleteLogs({ type, ...opts })
    await refreshSyncMeta(true)
  } catch (error) {
    onWriteFallback?.(`${type}_logs`, error)
    throw error
  }
}

export async function deletePublishLog(id: string): Promise<void> {
  await deleteLogOnServer("publish", { logId: id })
  await cache.deletePublishLog(id)
  markResourceSynced("publish_logs")
}

export async function clearPublishLogs(): Promise<void> {
  await deleteLogOnServer("publish", { clearAll: true })
  await cache.clearPublishLogs()
  markResourceSynced("publish_logs")
}

export async function deleteSyncLog(id: string): Promise<void> {
  await deleteLogOnServer("sync", { logId: id })
  await cache.deleteSyncLog(id)
  markResourceSynced("sync_logs")
}

export async function clearSyncLogs(): Promise<void> {
  await deleteLogOnServer("sync", { clearAll: true })
  await cache.clearSyncLogs()
  markResourceSynced("sync_logs")
}

export async function deleteLLMLog(id: string): Promise<void> {
  await deleteLogOnServer("llm", { logId: id })
  await cache.deleteLLMLog(id)
  markResourceSynced("llm_logs")
}

export async function clearLLMLogs(): Promise<void> {
  await deleteLogOnServer("llm", { clearAll: true })
  await cache.clearLLMLogs()
  markResourceSynced("llm_logs")
}

export async function deleteEmbeddingLog(id: string): Promise<void> {
  await deleteLogOnServer("embedding", { logId: id })
  await cache.deleteEmbeddingLog(id)
  markResourceSynced("embedding_logs")
}

export async function clearEmbeddingLogs(): Promise<void> {
  await deleteLogOnServer("embedding", { clearAll: true })
  await cache.clearEmbeddingLogs()
  markResourceSynced("embedding_logs")
}

export async function deleteNetworkLog(id: string): Promise<void> {
  await deleteLogOnServer("network", { logId: id })
  await cache.deleteNetworkLog(id)
  markResourceSynced("network_logs")
}

export async function clearNetworkLogs(): Promise<void> {
  await deleteLogOnServer("network", { clearAll: true })
  await cache.clearNetworkLogs()
  markResourceSynced("network_logs")
}

export async function deleteOldLogs(days: number): Promise<number> {
  try {
    const result = await api.deleteLogs({ olderThanDays: days })
    await refreshSyncMeta(true)
    const total = result.total ?? 0
    await cache.deleteOldLogs(days)
    return total
  } catch (error) {
    onWriteFallback?.("logs", error)
    return cache.deleteOldLogs(days)
  }
}

// --- stats & legacy bot cleanup ---

export async function getDBStats(): Promise<DBStats> {
  try {
    const remote = await api.getStats()
    const local = await cache.getDBStats()
    return {
      ...local,
      postCount: remote.postCount ?? local.postCount,
      channelCount: remote.channelCount ?? local.channelCount,
      summaryCount: remote.summaryCount ?? local.summaryCount,
      embeddedPostCount: remote.embeddedPostCount ?? local.embeddedPostCount,
      botCount: remote.botCount,
      destinationCount: remote.destinationCount,
      publishLogCount: remote.publishLogCount,
      syncLogCount: remote.syncLogCount,
      llmLogCount: remote.llmLogCount,
      embeddingLogCount: remote.embeddingLogCount ?? local.embeddingLogCount,
      networkLogCount: remote.networkLogCount ?? local.networkLogCount,
    } as DBStats
  } catch {
    const stats = await cache.getDBStats()
    return stats as DBStats
  }
}

export async function cleanupLegacyBots(): Promise<void> {
  const oldBots = await cache.getBots()
  if (oldBots.length > 0) {
    for (const bot of oldBots) {
      await cache.deleteBot(bot.id)
    }
  }
}

// --- network settings (server-backed) ---

export async function loadNetworkSettings(): Promise<Record<string, unknown>> {
  const row = await api.getNetworkSettings()
  return row.value
}

export async function saveNetworkSettings(
  value: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const row = await api.putNetworkSettings(value)
  return row.value
}

// --- server migration ---

export async function checkNeedsMigration(): Promise<boolean> {
  const localChannels = await cache.getChannels()
  if (localChannels.length === 0) return false
  try {
    await refreshSyncMeta(true)
    const remote = await api.listChannels()
    return remote.length === 0
  } catch {
    return false
  }
}

export async function importIndexedDBToServer(): Promise<
  Record<string, number>
> {
  const exported = await cache.exportDB()
  const [embeddings, translations] = await Promise.all([
    cache.getAllEmbeddings(),
    cache.initDB().then(async (db) => {
      if (!db.objectStoreNames.contains("translations"))
        return [] as PostTranslation[]
      return (await db.getAll("translations")) as PostTranslation[]
    }),
  ])
  const payload = {
    ...exported,
    data: {
      ...exported.data,
      embeddings,
      translations,
    },
  }
  const result = await api.importData(payload)
  await refreshSyncMeta(true)
  return result.imported
}

/** @deprecated Use getPostsByDateRange — kept for backward compatibility */
export async function getPostsByDateRangeCached(
  channelNames: string[],
  startDate: number,
  endDate: number,
) {
  return getPostsByDateRange(channelNames, startDate, endDate)
}

/** @deprecated Use saveSummary — kept for backward compatibility */
export async function saveSummarySynced(summary: Summary) {
  return saveSummary(summary)
}

export { cache }
