/**
 * Hybrid sync: API-first with IndexedDB cache (read-through).
 * On API write failure: fall back to IndexedDB and notify via onWriteFallback.
 */

import { api } from "@/api"
import { env } from "@/lib/env"
import type { DBStats, PostEmbedding, PostTranslation } from "../types"
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

// --- posts (cache-only leftovers, deleted with the mirror in A4) ---
//
// These three never touched the server: they are thin `lib/cache` wrappers from
// the browser-only era. A3 moves *API* access out of this file; something that
// only reads or clears IndexedDB has nothing to move to, and disappears when
// the mirror does. `getPostsWithoutEmbeddings` already has no callers.

export async function clearChannelPosts(channelName: string): Promise<void> {
  await cache.clearChannelPosts(channelName)
}

export async function deleteOldPosts(days: number): Promise<number> {
  return cache.deleteOldPosts(days)
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
