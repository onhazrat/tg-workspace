/**
 * Hybrid sync: API-first with IndexedDB cache (read-through).
 * On API write failure: fall back to IndexedDB and notify via onWriteFallback.
 */

import { api } from "@/api"
import { env } from "@/lib/env"
import type {
  BotCredential,
  ChatDestination,
  DBStats,
  Post,
  PostEmbedding,
  PostTranslation,
} from "../types"
import { stripToken } from "./botCredential"
import * as cache from "./cache"

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

// `singleFlight`/`resetInFlight` moved to `lib/singleFlight.ts` in A3.3 —
// they are shared infrastructure that outlives this file, and the resource
// families leaving it still need them.
import { singleFlight } from "./singleFlight"

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

/**
 * **No callers remain (A1c).** The three bulk readers this existed for now go
 * straight to the server feed: palette search (A1a), auto-regenerate prompt
 * assembly (A1b), and `computeScopedPosts` plus language detection (A1c).
 *
 * Kept only until A3, which deletes `repository.ts` as a unit and ports
 * `repository.posts.test.ts`'s `singleFlight` concurrency assertions to the
 * hook layer. Deleting it here would drop that coverage with nothing replacing
 * it. **Do not add a new caller** — use `api.getPostsFeed`.
 */
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

export { cache }
