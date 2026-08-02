/**
 * What is left of the hybrid-sync layer, waiting on A4.
 *
 * A3 emptied this file of API access: the resource families moved to
 * `lib/<family>/store.ts` and the etag-staleness and write-fallback machinery
 * that wrapped them is deleted. **Nothing here should grow.** Every remaining
 * export is either a thin `lib/cache` wrapper from the browser-only era or part
 * of the one-time IndexedDB→server migration, and all of it disappears with the
 * mirror in A4 (`lib/cache.ts`, `workers/dbWorker.ts`, `MigrationPrompt.tsx`).
 *
 * `getDBStats` is the one that still merges: it fills fields the server's stats
 * response omits from the local mirror. Deleting the mirror means checking
 * whether the server covers every `DBStats` field first — do that in A4 rather
 * than assuming.
 */

import { api } from "@/api"
import { queryClient } from "@/lib/queryClient"
import type { DBStats, PostTranslation } from "../types"
import * as cache from "./cache"

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

// --- server migration ---

export async function checkNeedsMigration(): Promise<boolean> {
  const localChannels = await cache.getChannels()
  if (localChannels.length === 0) return false
  try {
    // The `refreshSyncMeta(true)` that used to sit here primed an etag cache
    // that A3 deleted; it never affected the comparison below.
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
  // A wholesale replacement of every table, and nothing wrote any of it
  // through — the one case in this codebase where invalidating *everything* is
  // right. The `refreshSyncMeta(true)` this replaces achieved the same thing
  // via the etag layer that A3 deleted.
  await queryClient.invalidateQueries()
  return result.imported
}

export { cache }
