import { type IDBPDatabase, openDB } from "idb"
import type {
  BotCredential,
  Channel,
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
} from "../types"
import { logger } from "./logger"

const DB_NAME = "TelegramSummarizerDB"
const STORE_POSTS = "posts"
const STORE_CHANNELS = "channels"
const STORE_SUMMARIES = "summaries"
const STORE_BOT_CREDENTIALS = "bot_credentials"
const STORE_CHAT_DESTINATIONS = "chat_destinations"
const STORE_PUBLISH_LOGS = "publish_logs"
const STORE_SYNC_LOGS = "sync_logs"
const STORE_LLM_LOGS = "llm_logs"
const STORE_EMBEDDING_LOGS = "embedding_logs"
const STORE_NETWORK_LOGS = "network_logs"
const STORE_EMBEDDINGS = "embeddings"
const STORE_TRANSLATIONS = "translations"

export const INDEXEDDB_STORE_NAMES = [
  STORE_POSTS,
  STORE_CHANNELS,
  STORE_SUMMARIES,
  STORE_BOT_CREDENTIALS,
  STORE_CHAT_DESTINATIONS,
  STORE_PUBLISH_LOGS,
  STORE_SYNC_LOGS,
  STORE_LLM_LOGS,
  STORE_EMBEDDING_LOGS,
  STORE_NETWORK_LOGS,
  STORE_EMBEDDINGS,
  STORE_TRANSLATIONS,
] as const

export const DB_VERSION = 13

let dbPromise: Promise<IDBPDatabase> | null = null

export function initDB(): Promise<IDBPDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = (async () => {
    logger.debug("[DB] Initializing database...")
    return openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        logger.debug(
          `[DB] Upgrading database from version ${oldVersion} to ${newVersion}`,
        )
        if (oldVersion < 1) {
          const postStore = db.createObjectStore(STORE_POSTS, {
            keyPath: ["channelName", "id"],
          })
          postStore.createIndex("timestamp", "timestamp")
          postStore.createIndex("channelName", "channelName")
          db.createObjectStore(STORE_CHANNELS, { keyPath: "id" })
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(STORE_SUMMARIES)) {
            const summaryStore = db.createObjectStore(STORE_SUMMARIES, {
              keyPath: "id",
            })
            summaryStore.createIndex("timestamp", "timestamp")
          }
        }
        if (oldVersion < 3) {
          // Version 3: Added chatMessages to Summary objects.
        }
        if (oldVersion < 4) {
          if (!db.objectStoreNames.contains("bots")) {
            db.createObjectStore("bots", { keyPath: "id" })
          }
        }
        if (oldVersion < 5) {
          if (!db.objectStoreNames.contains(STORE_BOT_CREDENTIALS)) {
            db.createObjectStore(STORE_BOT_CREDENTIALS, { keyPath: "id" })
          }
          if (!db.objectStoreNames.contains(STORE_CHAT_DESTINATIONS)) {
            db.createObjectStore(STORE_CHAT_DESTINATIONS, { keyPath: "id" })
          }
        }
        if (oldVersion < 6) {
          if (!db.objectStoreNames.contains(STORE_PUBLISH_LOGS)) {
            const logStore = db.createObjectStore(STORE_PUBLISH_LOGS, {
              keyPath: "id",
            })
            logStore.createIndex("timestamp", "timestamp")
            logStore.createIndex("summaryId", "summaryId")
          }
        }
        if (oldVersion < 7) {
          if (!db.objectStoreNames.contains(STORE_SYNC_LOGS)) {
            const syncLogStore = db.createObjectStore(STORE_SYNC_LOGS, {
              keyPath: "id",
            })
            syncLogStore.createIndex("timestamp", "timestamp")
            syncLogStore.createIndex("channelName", "channelName")
          }
        }
        if (oldVersion < 8) {
          if (!db.objectStoreNames.contains(STORE_LLM_LOGS)) {
            const llmLogStore = db.createObjectStore(STORE_LLM_LOGS, {
              keyPath: "id",
            })
            llmLogStore.createIndex("timestamp", "timestamp")
            llmLogStore.createIndex("type", "type")
          }
        }
        if (oldVersion < 9 && transaction) {
          const postStore = transaction.objectStore(STORE_POSTS)
          if (!postStore.indexNames.contains("channelName_timestamp")) {
            postStore.createIndex("channelName_timestamp", [
              "channelName",
              "timestamp",
            ])
          }
        }
        if (oldVersion < 10 && transaction) {
          const postStore = transaction.objectStore(STORE_POSTS)
          if (!postStore.indexNames.contains("hasEmbedding")) {
            postStore.createIndex("hasEmbedding", "hasEmbedding")
          }
        }
        if (oldVersion < 11) {
          if (!db.objectStoreNames.contains(STORE_EMBEDDING_LOGS)) {
            const embeddingLogStore = db.createObjectStore(
              STORE_EMBEDDING_LOGS,
              { keyPath: "id" },
            )
            embeddingLogStore.createIndex("timestamp", "timestamp")
          }
          if (!db.objectStoreNames.contains(STORE_NETWORK_LOGS)) {
            const networkLogStore = db.createObjectStore(STORE_NETWORK_LOGS, {
              keyPath: "id",
            })
            networkLogStore.createIndex("timestamp", "timestamp")
            networkLogStore.createIndex("source", "source")
          }
        }
        if (oldVersion < 12) {
          if (!db.objectStoreNames.contains(STORE_EMBEDDINGS)) {
            const embeddingStore = db.createObjectStore(STORE_EMBEDDINGS, {
              keyPath: "id",
            })
            embeddingStore.createIndex("channelName", "channelName")
            embeddingStore.createIndex("postId", "postId")
          }
        }
        if (oldVersion < 13) {
          if (!db.objectStoreNames.contains(STORE_TRANSLATIONS)) {
            const translationStore = db.createObjectStore(STORE_TRANSLATIONS, {
              keyPath: "id",
            })
            translationStore.createIndex("channelName", "channelName")
            translationStore.createIndex("postId", "postId")
            translationStore.createIndex("language", "language")
          }
        }
      },
    })
  })()

  return dbPromise
}

export async function savePosts(posts: Post[]) {
  const db = await initDB()
  const tx = db.transaction(STORE_POSTS, "readwrite")
  const store = tx.objectStore(STORE_POSTS)
  await Promise.all(posts.map((post) => store.put(post)))
  await tx.done
}

export async function getPostsWithoutEmbeddings(
  limit: number = 50,
): Promise<Post[]> {
  const db = await initDB()
  const tx = db.transaction([STORE_POSTS, STORE_EMBEDDINGS], "readonly")
  const postStore = tx.objectStore(STORE_POSTS)
  const embeddingStore = tx.objectStore(STORE_EMBEDDINGS)

  // Get all post keys and embedding keys
  const postKeys = await postStore.getAllKeys()
  const embeddingKeys = await embeddingStore.getAllKeys()

  // Convert embedding keys to a Set for fast lookup
  // Embedding keys are strings like `${channelName}_${postId}`
  const embeddingKeySet = new Set(embeddingKeys.map((k) => String(k)))

  const results: Post[] = []

  // Iterate through post keys and find ones missing from embeddings
  for (const key of postKeys) {
    // Post keys are arrays: [channelName, id]
    const channelName = (key as any)[0]
    const postId = (key as any)[1]
    const embeddingId = `${channelName}_${postId}`

    if (!embeddingKeySet.has(embeddingId)) {
      const post = await postStore.get(key)
      if (post) {
        results.push(post)
        if (results.length >= limit) break
      }
    }
  }

  return results
}

export async function migrateEmbeddingsData() {
  const hasMigrated = localStorage.getItem("embeddings_migrated_v1")
  if (hasMigrated) return

  try {
    const db = await initDB()
    logger.debug("[DB] Starting embeddings migration...")
    const tx = db.transaction([STORE_POSTS, STORE_EMBEDDINGS], "readwrite")
    const postStore = tx.objectStore(STORE_POSTS)
    const embeddingStore = tx.objectStore(STORE_EMBEDDINGS)

    let cursor = await postStore.openCursor()
    let migratedCount = 0

    while (cursor) {
      const post = cursor.value
      let needsUpdate = false

      if (post.embedding && post.embedding.length > 0) {
        const embeddingId = `${post.channelName}_${post.id}`
        await embeddingStore.put({
          id: embeddingId,
          channelName: post.channelName,
          postId: post.id,
          vector: post.embedding,
          text: post.text || post.channelName,
        })
        migratedCount++
        needsUpdate = true
      }

      if ("embedding" in post || "hasEmbedding" in post) {
        delete post.embedding
        delete post.hasEmbedding
        needsUpdate = true
      }

      if (needsUpdate) {
        await cursor.update(post)
      }

      cursor = await cursor.continue()
    }

    await tx.done
    localStorage.setItem("embeddings_migrated_v1", "true")
    logger.debug(
      `[DB] Embeddings migration complete. Migrated ${migratedCount} embeddings.`,
    )
  } catch (error) {
    console.error("[DB] Embeddings migration failed:", error)
  }
}

export async function migrateSummaryDates() {
  const hasMigrated = localStorage.getItem("summary_dates_migrated_v1")
  if (hasMigrated) return

  try {
    const db = await initDB()
    logger.debug("[DB] Starting summary dates migration...")
    const tx = db.transaction(STORE_SUMMARIES, "readwrite")
    const store = tx.objectStore(STORE_SUMMARIES)

    let cursor = await store.openCursor()
    let migratedCount = 0

    while (cursor) {
      const summary = cursor.value
      let needsUpdate = false

      if (typeof summary.startDate === "string") {
        summary.startDate = new Date(summary.startDate).getTime()
        needsUpdate = true
      }
      if (typeof summary.endDate === "string") {
        summary.endDate = new Date(summary.endDate).getTime()
        needsUpdate = true
      }

      if (needsUpdate) {
        await cursor.update(summary)
        migratedCount++
      }
      cursor = await cursor.continue()
    }

    await tx.done
    logger.debug(
      `[DB] Summary dates migration complete. Migrated ${migratedCount} summaries.`,
    )
    localStorage.setItem("summary_dates_migrated_v1", "true")
  } catch (error) {
    console.error("[DB] Error during summary dates migration:", error)
  }
}

export async function saveEmbeddings(embeddings: PostEmbedding[]) {
  const db = await initDB()
  const tx = db.transaction(STORE_EMBEDDINGS, "readwrite")
  const store = tx.objectStore(STORE_EMBEDDINGS)
  await Promise.all(embeddings.map((embedding) => store.put(embedding)))
  await tx.done
}

export async function getAllEmbeddings(): Promise<PostEmbedding[]> {
  const db = await initDB()
  const tx = db.transaction(STORE_EMBEDDINGS, "readonly")
  const store = tx.objectStore(STORE_EMBEDDINGS)
  return store.getAll()
}

export async function saveTranslation(translation: PostTranslation) {
  const db = await initDB()
  await db.put(STORE_TRANSLATIONS, translation)
}

export async function getTranslation(
  channelName: string,
  postId: number,
  language: string,
): Promise<PostTranslation | undefined> {
  const db = await initDB()
  const id = `${channelName}_${postId}_${language}`
  return db.get(STORE_TRANSLATIONS, id)
}

export async function getPost(
  channelName: string,
  id: number,
): Promise<Post | undefined> {
  const db = await initDB()
  return db.get(STORE_POSTS, [channelName, id])
}

export async function getPostsByDateRange(
  channels: string[],
  startDate: number,
  endDate: number,
) {
  if (startDate > endDate) {
    console.warn(
      "[DB] getPostsByDateRange: startDate > endDate, returning empty results",
      { startDate, endDate },
    )
    return []
  }

  const db = await initDB()
  const results: Post[] = []

  const tx = db.transaction(STORE_POSTS, "readonly")
  const store = tx.objectStore(STORE_POSTS)

  // Use composite index if available
  if (store.indexNames.contains("channelName_timestamp")) {
    const index = store.index("channelName_timestamp")
    for (const channelName of channels) {
      const range = IDBKeyRange.bound(
        [channelName, startDate],
        [channelName, endDate],
      )
      const posts = await index.getAll(range)
      results.push(...posts)
    }
  } else {
    // Fallback to timestamp index
    const index = store.index("timestamp")
    const range = IDBKeyRange.bound(startDate, endDate)
    const allPosts: Post[] = await index.getAll(range)
    results.push(
      ...allPosts.filter((post) => channels.includes(post.channelName)),
    )
  }

  return results
}

export async function saveChannel(channel: Channel) {
  const db = await initDB()
  await db.put(STORE_CHANNELS, channel)
}

/**
 * Write many channels in one transaction.
 *
 * Mirroring the channel list used to `await saveChannel(...)` in a loop — one
 * IndexedDB transaction per channel, serially. At the ~1,070 channels a real
 * account holds that is 1,070 round-trips, and it sat in front of the data the
 * Channels tab renders. Same shape as `savePosts`.
 */
export async function saveChannels(channels: Channel[]) {
  if (!channels.length) return
  const db = await initDB()
  const tx = db.transaction(STORE_CHANNELS, "readwrite")
  const store = tx.objectStore(STORE_CHANNELS)
  await Promise.all(channels.map((channel) => store.put(channel)))
  await tx.done
}

export async function deleteChannel(id: string) {
  const db = await initDB()
  await db.delete(STORE_CHANNELS, id)
}

export async function getChannels(): Promise<Channel[]> {
  const db = await initDB()
  return db.getAll(STORE_CHANNELS)
}

export async function getChannelStats(channelName: string) {
  const db = await initDB()
  const tx = db.transaction(STORE_POSTS, "readonly")
  const store = tx.objectStore(STORE_POSTS)
  const index = store.index("channelName")

  const count = await index.count(IDBKeyRange.only(channelName))
  if (count === 0) return null

  // Get maxId by opening a cursor in reverse
  let maxId = 0
  let minId = Infinity

  const maxCursor = await index.openCursor(
    IDBKeyRange.only(channelName),
    "prev",
  )
  if (maxCursor) {
    maxId = maxCursor.value.id
  }

  const minCursor = await index.openCursor(
    IDBKeyRange.only(channelName),
    "next",
  )
  if (minCursor) {
    minId = minCursor.value.id
  }

  // Calculate velocity (posts per hour) using EMA of time differences
  let velocity = 0
  if (count >= 2) {
    const timestamps: number[] = []
    // Fetch up to 100 most recent posts for this channel
    let c = await index.openCursor(IDBKeyRange.only(channelName), "prev")
    while (c && timestamps.length < 100) {
      if (c.value.timestamp) {
        timestamps.push(c.value.timestamp)
      }
      c = await c.continue()
    }
    timestamps.reverse() // chronological order

    if (timestamps.length >= 2) {
      let emaDiff = (timestamps[1] - timestamps[0]) / (1000 * 60 * 60) // in hours
      const alpha = 0.1

      for (let i = 2; i < timestamps.length; i++) {
        const diff = (timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60)
        emaDiff = alpha * diff + (1 - alpha) * emaDiff
      }

      // Factor in time since last post if it's larger than the EMA
      const timeSinceLast =
        (Date.now() - timestamps[timestamps.length - 1]) / (1000 * 60 * 60)
      if (timeSinceLast > emaDiff) {
        emaDiff = alpha * timeSinceLast + (1 - alpha) * emaDiff
      }

      if (emaDiff > 0) {
        velocity = 1 / emaDiff
      }
    }
  }

  return {
    count,
    minId,
    maxId,
    velocity,
  }
}

export async function clearAllPosts() {
  const db = await initDB()
  await db.clear(STORE_POSTS)
}

export async function clearChannelPosts(channelName: string) {
  const db = await initDB()
  const tx = db.transaction(STORE_POSTS, "readwrite")
  const index = tx.store.index("channelName")
  let cursor = await index.openCursor(IDBKeyRange.only(channelName))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

export async function saveSummary(summary: Summary) {
  const db = await initDB()
  await db.put(STORE_SUMMARIES, summary)
}

/**
 * Merge a light list row into the cache.
 *
 * A plain `put` of a list row would erase any `citedPosts`/`promptText`/
 * `chatMessages` already cached for that summary, since the list projection
 * does not carry them — so the offline copy would silently lose its citations.
 */
export async function saveSummaryListItem(item: SummaryListItem) {
  const db = await initDB()
  const existing = await db.get(STORE_SUMMARIES, item.id)
  const {
    chatMessageCount: _chatMessageCount,
    promptExcerpt: _promptExcerpt,
    ...base
  } = item
  await db.put(
    STORE_SUMMARIES,
    existing ? { ...existing, ...base } : (base as Summary),
  )
}

export async function getSummaries(): Promise<Summary[]> {
  const db = await initDB()
  return db.getAllFromIndex(STORE_SUMMARIES, "timestamp")
}

export async function deleteSummary(id: string) {
  const db = await initDB()
  await db.delete(STORE_SUMMARIES, id)
}

export async function getDBStats() {
  const db = await initDB()
  const postCount = await db.count(STORE_POSTS)
  const channelCount = await db.count(STORE_CHANNELS)
  const summaryCount = await db.count(STORE_SUMMARIES)

  let embeddingLogCount = 0
  if (db.objectStoreNames.contains(STORE_EMBEDDING_LOGS)) {
    embeddingLogCount = await db.count(STORE_EMBEDDING_LOGS)
  }

  let networkLogCount = 0
  if (db.objectStoreNames.contains(STORE_NETWORK_LOGS)) {
    networkLogCount = await db.count(STORE_NETWORK_LOGS)
  }

  let embeddedPostCount = 0
  if (db.objectStoreNames.contains(STORE_POSTS)) {
    const tx = db.transaction(STORE_POSTS, "readonly")
    const store = tx.objectStore(STORE_POSTS)
    if (store.indexNames.contains("hasEmbedding")) {
      const index = store.index("hasEmbedding")
      embeddedPostCount = await index.count(IDBKeyRange.only(1))
    } else {
      const allPosts = await store.getAll()
      embeddedPostCount = allPosts.filter((p) => p.hasEmbedding === 1).length
    }
  }

  let storageEstimate:
    | Awaited<ReturnType<NonNullable<typeof navigator.storage>["estimate"]>>
    | undefined
  if (navigator.storage?.estimate) {
    storageEstimate = await navigator.storage.estimate()
  }

  return {
    postCount,
    channelCount,
    summaryCount,
    embeddedPostCount,
    embeddingLogCount,
    networkLogCount,
    storageEstimate,
  }
}

export async function exportDBMetadata() {
  // Get all localStorage items
  const localStorageData: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) {
      localStorageData[key] = localStorage.getItem(key) || ""
    }
  }

  return {
    version: 2,
    timestamp: Date.now(),
    data: {
      localStorage: localStorageData,
    },
  }
}

export async function getPostCount(): Promise<number> {
  const db = await initDB()
  return db.count(STORE_POSTS)
}

export async function getPostsChunk(
  offset: number,
  limit: number,
): Promise<Post[]> {
  const db = await initDB()
  const tx = db.transaction(STORE_POSTS, "readonly")
  const store = tx.objectStore(STORE_POSTS)
  const results: Post[] = []

  let cursor = await store.openCursor()

  if (offset > 0 && cursor) {
    try {
      await cursor.advance(offset)
    } catch (_e) {
      // If advance fails (e.g. offset out of bounds), just return empty
      return []
    }
  }

  while (cursor && results.length < limit) {
    results.push(cursor.value)
    cursor = await cursor.continue()
  }

  return results
}

export async function exportDB() {
  const db = await initDB()
  const posts = await db.getAll(STORE_POSTS)
  const channels = await db.getAll(STORE_CHANNELS)
  const summaries = await db.getAll(STORE_SUMMARIES)

  let bot_credentials: BotCredential[] = []
  if (db.objectStoreNames.contains(STORE_BOT_CREDENTIALS)) {
    bot_credentials = await db.getAll(STORE_BOT_CREDENTIALS)
  }

  let chat_destinations: ChatDestination[] = []
  if (db.objectStoreNames.contains(STORE_CHAT_DESTINATIONS)) {
    chat_destinations = await db.getAll(STORE_CHAT_DESTINATIONS)
  }

  let publish_logs: PublishLog[] = []
  if (db.objectStoreNames.contains(STORE_PUBLISH_LOGS)) {
    publish_logs = await db.getAll(STORE_PUBLISH_LOGS)
  }

  let sync_logs: SyncLog[] = []
  if (db.objectStoreNames.contains(STORE_SYNC_LOGS)) {
    sync_logs = await db.getAll(STORE_SYNC_LOGS)
  }

  let llm_logs: LLMLog[] = []
  if (db.objectStoreNames.contains(STORE_LLM_LOGS)) {
    llm_logs = await db.getAll(STORE_LLM_LOGS)
  }

  let embedding_logs: EmbeddingLog[] = []
  if (db.objectStoreNames.contains(STORE_EMBEDDING_LOGS)) {
    embedding_logs = await db.getAll(STORE_EMBEDDING_LOGS)
  }

  let network_logs: NetworkLog[] = []
  if (db.objectStoreNames.contains(STORE_NETWORK_LOGS)) {
    network_logs = await db.getAll(STORE_NETWORK_LOGS)
  }

  // Get all localStorage items
  const localStorageData: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) {
      localStorageData[key] = localStorage.getItem(key) || ""
    }
  }

  return {
    version: 2,
    timestamp: Date.now(),
    data: {
      posts,
      channels,
      summaries,
      bot_credentials,
      chat_destinations,
      publish_logs,
      sync_logs,
      llm_logs,
      embedding_logs,
      network_logs,
      localStorage: localStorageData,
    },
  }
}

export async function importDB(
  data: {
    data: {
      posts?: Post[]
      channels?: Channel[]
      summaries?: Summary[]
      bot_credentials?: BotCredential[]
      chat_destinations?: ChatDestination[]
      publish_logs?: PublishLog[]
      sync_logs?: SyncLog[]
      llm_logs?: LLMLog[]
      embedding_logs?: EmbeddingLog[]
      network_logs?: NetworkLog[]
      localStorage?: Record<string, string>
    }
  },
  clear: boolean = true,
) {
  const db = await initDB()

  const storesToUpdate: string[] = []
  if (db.objectStoreNames.contains(STORE_POSTS))
    storesToUpdate.push(STORE_POSTS)
  if (db.objectStoreNames.contains(STORE_CHANNELS))
    storesToUpdate.push(STORE_CHANNELS)
  if (db.objectStoreNames.contains(STORE_SUMMARIES))
    storesToUpdate.push(STORE_SUMMARIES)
  if (db.objectStoreNames.contains(STORE_BOT_CREDENTIALS))
    storesToUpdate.push(STORE_BOT_CREDENTIALS)
  if (db.objectStoreNames.contains(STORE_CHAT_DESTINATIONS))
    storesToUpdate.push(STORE_CHAT_DESTINATIONS)
  if (db.objectStoreNames.contains(STORE_PUBLISH_LOGS))
    storesToUpdate.push(STORE_PUBLISH_LOGS)
  if (db.objectStoreNames.contains(STORE_SYNC_LOGS))
    storesToUpdate.push(STORE_SYNC_LOGS)
  if (db.objectStoreNames.contains(STORE_LLM_LOGS))
    storesToUpdate.push(STORE_LLM_LOGS)
  if (db.objectStoreNames.contains(STORE_EMBEDDING_LOGS))
    storesToUpdate.push(STORE_EMBEDDING_LOGS)
  if (db.objectStoreNames.contains(STORE_NETWORK_LOGS))
    storesToUpdate.push(STORE_NETWORK_LOGS)

  if (storesToUpdate.length > 0) {
    const tx = db.transaction(storesToUpdate, "readwrite")

    // Clear all stores first to ensure exact state match if clear is true
    if (clear) {
      for (const store of storesToUpdate) {
        await tx.objectStore(store).clear()
      }
    }

    if (data.data.posts && storesToUpdate.includes(STORE_POSTS)) {
      const store = tx.objectStore(STORE_POSTS)
      for (const post of data.data.posts) {
        await store.put(post)
      }
    }

    if (data.data.channels && storesToUpdate.includes(STORE_CHANNELS)) {
      const store = tx.objectStore(STORE_CHANNELS)
      for (const channel of data.data.channels) {
        await store.put(channel)
      }
    }

    if (data.data.summaries && storesToUpdate.includes(STORE_SUMMARIES)) {
      const store = tx.objectStore(STORE_SUMMARIES)
      for (const summary of data.data.summaries) {
        await store.put(summary)
      }
    }

    if (
      data.data.bot_credentials &&
      storesToUpdate.includes(STORE_BOT_CREDENTIALS)
    ) {
      const store = tx.objectStore(STORE_BOT_CREDENTIALS)
      for (const bot of data.data.bot_credentials) {
        await store.put(bot)
      }
    }

    if (
      data.data.chat_destinations &&
      storesToUpdate.includes(STORE_CHAT_DESTINATIONS)
    ) {
      const store = tx.objectStore(STORE_CHAT_DESTINATIONS)
      for (const dest of data.data.chat_destinations) {
        await store.put(dest)
      }
    }

    if (data.data.publish_logs && storesToUpdate.includes(STORE_PUBLISH_LOGS)) {
      const store = tx.objectStore(STORE_PUBLISH_LOGS)
      for (const log of data.data.publish_logs) {
        await store.put(log)
      }
    }

    if (data.data.sync_logs && storesToUpdate.includes(STORE_SYNC_LOGS)) {
      const store = tx.objectStore(STORE_SYNC_LOGS)
      for (const log of data.data.sync_logs) {
        await store.put(log)
      }
    }

    if (data.data.llm_logs && storesToUpdate.includes(STORE_LLM_LOGS)) {
      const store = tx.objectStore(STORE_LLM_LOGS)
      for (const log of data.data.llm_logs) {
        await store.put(log)
      }
    }

    if (
      data.data.embedding_logs &&
      storesToUpdate.includes(STORE_EMBEDDING_LOGS)
    ) {
      const store = tx.objectStore(STORE_EMBEDDING_LOGS)
      for (const log of data.data.embedding_logs) {
        await store.put(log)
      }
    }

    if (data.data.network_logs && storesToUpdate.includes(STORE_NETWORK_LOGS)) {
      const store = tx.objectStore(STORE_NETWORK_LOGS)
      for (const log of data.data.network_logs) {
        await store.put(log)
      }
    }

    await tx.done
  }

  if (data.data.localStorage && clear) {
    localStorage.clear()
    for (const [key, value] of Object.entries(data.data.localStorage)) {
      localStorage.setItem(key, value)
    }
  } else if (data.data.localStorage) {
    // Just merge if not clearing
    for (const [key, value] of Object.entries(data.data.localStorage)) {
      localStorage.setItem(key, value)
    }
  }
}

export async function clearTable(tableName: string) {
  const db = await initDB()
  if (db.objectStoreNames.contains(tableName)) {
    await db.clear(tableName)
  } else {
    throw new Error(`Table ${tableName} does not exist.`)
  }
}

export async function clearAllData() {
  const db = await initDB()
  const storesToClear: string[] = []
  if (db.objectStoreNames.contains(STORE_POSTS)) storesToClear.push(STORE_POSTS)
  if (db.objectStoreNames.contains(STORE_CHANNELS))
    storesToClear.push(STORE_CHANNELS)
  if (db.objectStoreNames.contains(STORE_SUMMARIES))
    storesToClear.push(STORE_SUMMARIES)
  if (db.objectStoreNames.contains(STORE_BOT_CREDENTIALS))
    storesToClear.push(STORE_BOT_CREDENTIALS)
  if (db.objectStoreNames.contains(STORE_CHAT_DESTINATIONS))
    storesToClear.push(STORE_CHAT_DESTINATIONS)
  if (db.objectStoreNames.contains(STORE_PUBLISH_LOGS))
    storesToClear.push(STORE_PUBLISH_LOGS)
  if (db.objectStoreNames.contains(STORE_SYNC_LOGS))
    storesToClear.push(STORE_SYNC_LOGS)
  if (db.objectStoreNames.contains(STORE_LLM_LOGS))
    storesToClear.push(STORE_LLM_LOGS)
  if (db.objectStoreNames.contains(STORE_EMBEDDING_LOGS))
    storesToClear.push(STORE_EMBEDDING_LOGS)
  if (db.objectStoreNames.contains(STORE_NETWORK_LOGS))
    storesToClear.push(STORE_NETWORK_LOGS)
  if (db.objectStoreNames.contains(STORE_TRANSLATIONS))
    storesToClear.push(STORE_TRANSLATIONS)

  if (storesToClear.length > 0) {
    const tx = db.transaction(storesToClear, "readwrite")
    for (const store of storesToClear) {
      await tx.objectStore(store).clear()
    }
    await tx.done
  }

  localStorage.clear()
}

export async function saveBotCredential(bot: BotCredential) {
  const db = await initDB()
  await db.put(STORE_BOT_CREDENTIALS, bot)
}

export async function getBotCredentials(): Promise<BotCredential[]> {
  const db = await initDB()
  return db.getAll(STORE_BOT_CREDENTIALS)
}

export async function deleteBotCredential(id: string) {
  const db = await initDB()
  await db.delete(STORE_BOT_CREDENTIALS, id)
}

export async function saveChatDestination(dest: ChatDestination) {
  const db = await initDB()
  await db.put(STORE_CHAT_DESTINATIONS, dest)
}

export async function getChatDestinations(): Promise<ChatDestination[]> {
  const db = await initDB()
  return db.getAll(STORE_CHAT_DESTINATIONS)
}

export async function deleteChatDestination(id: string) {
  const db = await initDB()
  await db.delete(STORE_CHAT_DESTINATIONS, id)
}

// Keep old Bot functions for migration if needed, but they point to the old 'bots' store
export async function getBots(): Promise<BotCredential[]> {
  const db = await initDB()
  if (!db.objectStoreNames.contains("bots")) return []
  return db.getAll("bots")
}

export async function deleteBot(id: string) {
  const db = await initDB()
  if (!db.objectStoreNames.contains("bots")) return
  await db.delete("bots", id)
}

export async function savePublishLog(log: PublishLog) {
  const db = await initDB()
  await db.put(STORE_PUBLISH_LOGS, log)
}

export async function getPublishLogs(): Promise<PublishLog[]> {
  const db = await initDB()
  return db.getAllFromIndex(STORE_PUBLISH_LOGS, "timestamp")
}

export async function deletePublishLog(id: string) {
  const db = await initDB()
  await db.delete(STORE_PUBLISH_LOGS, id)
}

export async function clearPublishLogs() {
  const db = await initDB()
  await db.clear(STORE_PUBLISH_LOGS)
}

export async function saveSyncLog(log: SyncLog) {
  logger.debug(`[DB] Saving sync log:`, log)
  const db = await initDB()
  await db.put(STORE_SYNC_LOGS, log)
  logger.debug(`[DB] Sync log saved successfully.`)
}

export async function getSyncLogs(): Promise<SyncLog[]> {
  const db = await initDB()
  return db.getAllFromIndex(STORE_SYNC_LOGS, "timestamp")
}

export async function deleteSyncLog(id: string) {
  const db = await initDB()
  await db.delete(STORE_SYNC_LOGS, id)
}

export async function clearSyncLogs() {
  const db = await initDB()
  await db.clear(STORE_SYNC_LOGS)
}

export async function saveLLMLog(log: LLMLog) {
  const db = await initDB()
  await db.put(STORE_LLM_LOGS, log)
}

export async function getLLMLogs(): Promise<LLMLog[]> {
  const db = await initDB()
  return db.getAllFromIndex(STORE_LLM_LOGS, "timestamp")
}

export async function deleteLLMLog(id: string) {
  const db = await initDB()
  await db.delete(STORE_LLM_LOGS, id)
}

export async function clearLLMLogs() {
  const db = await initDB()
  await db.clear(STORE_LLM_LOGS)
}

export async function saveEmbeddingLog(log: EmbeddingLog) {
  const db = await initDB()
  await db.put(STORE_EMBEDDING_LOGS, log)
}

export async function getEmbeddingLogs(): Promise<EmbeddingLog[]> {
  const db = await initDB()
  return db.getAllFromIndex(STORE_EMBEDDING_LOGS, "timestamp")
}

export async function deleteEmbeddingLog(id: string) {
  const db = await initDB()
  await db.delete(STORE_EMBEDDING_LOGS, id)
}

export async function clearEmbeddingLogs() {
  const db = await initDB()
  await db.clear(STORE_EMBEDDING_LOGS)
}

export async function saveNetworkLog(log: NetworkLog) {
  const db = await initDB()
  await db.put(STORE_NETWORK_LOGS, log)
}

export async function getNetworkLogs(): Promise<NetworkLog[]> {
  const db = await initDB()
  return db.getAllFromIndex(STORE_NETWORK_LOGS, "timestamp")
}

export async function deleteNetworkLog(id: string) {
  const db = await initDB()
  await db.delete(STORE_NETWORK_LOGS, id)
}

export async function clearNetworkLogs() {
  const db = await initDB()
  await db.clear(STORE_NETWORK_LOGS)
}

export async function getTableSizes(): Promise<
  { name: string; size: number; count: number }[]
> {
  const db = await initDB()
  const storeNames = Array.from(db.objectStoreNames)
  const sizes: { name: string; size: number; count: number }[] = []

  for (const storeName of storeNames) {
    const tx = db.transaction(storeName, "readonly")
    const store = tx.objectStore(storeName)
    let size = 0
    let count = 0

    let cursor = await store.openCursor()
    while (cursor) {
      count++
      const value = cursor.value
      // Approximate size by stringifying
      size += new Blob([JSON.stringify(value)]).size
      cursor = await cursor.continue()
    }

    sizes.push({ name: storeName, size, count })
  }

  return sizes
}

export async function runQuery(
  storeName: string,
  query: string,
): Promise<any[]> {
  const db = await initDB()
  if (!db.objectStoreNames.contains(storeName)) {
    throw new Error(`Store ${storeName} does not exist`)
  }

  const tx = db.transaction(storeName, "readonly")
  const store = tx.objectStore(storeName)
  const allRecords = await store.getAll()

  if (!query || query.trim() === "") {
    return allRecords.slice(0, 100) // Return first 100 if no query
  }

  // Basic filtering using eval for simplicity in this admin tool
  // WARNING: This is dangerous in production, but acceptable for a local admin tool
  // A safer approach would be to parse the query, but for now we'll use a simple function
  try {
    // Create a safe-ish evaluation context
    const filterFn = new Function(
      "record",
      `
      try {
        with(record) {
          return ${query};
        }
      } catch(e) {
        return false;
      }
    `,
    )

    const results = allRecords.filter((record) => filterFn(record))
    return results.slice(0, 100) // Limit to 100 results to prevent UI freezing
  } catch (err) {
    throw new Error(`Invalid query: ${(err as Error).message}`)
  }
}

export async function deleteOldPosts(days: number): Promise<number> {
  if (days <= 0) return 0

  const db = await initDB()
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000
  let deletedCount = 0

  const tx = db.transaction(
    [STORE_POSTS, STORE_EMBEDDINGS, STORE_TRANSLATIONS],
    "readwrite",
  )
  const postStore = tx.objectStore(STORE_POSTS)
  const embeddingStore = tx.objectStore(STORE_EMBEDDINGS)
  const translationStore = tx.objectStore(STORE_TRANSLATIONS)

  const index = postStore.index("timestamp")
  const range = IDBKeyRange.upperBound(cutoffTime)

  let cursor = await index.openCursor(range)

  while (cursor) {
    const post = cursor.value

    // Delete associated embedding
    const embeddingId = `${post.channelName}_${post.id}`
    await embeddingStore.delete(embeddingId)

    // Delete associated translations
    const translationIndex = translationStore.index("postId")
    let transCursor = await translationIndex.openCursor(
      IDBKeyRange.only(post.id),
    )
    while (transCursor) {
      if (transCursor.value.channelName === post.channelName) {
        await transCursor.delete()
      }
      transCursor = await transCursor.continue()
    }

    // Delete the post
    await cursor.delete()
    deletedCount++
    cursor = await cursor.continue()
  }

  await tx.done
  logger.debug(`[DB] Deleted ${deletedCount} posts older than ${days} days.`)
  return deletedCount
}

export async function deleteOldLogs(days: number): Promise<number> {
  if (days <= 0) return 0

  const db = await initDB()
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000
  let deletedCount = 0

  const logStores = [
    STORE_PUBLISH_LOGS,
    STORE_SYNC_LOGS,
    STORE_LLM_LOGS,
    STORE_EMBEDDING_LOGS,
    STORE_NETWORK_LOGS,
  ]

  // Filter out stores that might not exist in older DB versions
  const existingStores = logStores.filter((store) =>
    db.objectStoreNames.contains(store),
  )

  if (existingStores.length === 0) return 0

  const tx = db.transaction(existingStores, "readwrite")

  for (const storeName of existingStores) {
    const store = tx.objectStore(storeName)
    if (store.indexNames.contains("timestamp")) {
      const index = store.index("timestamp")
      const range = IDBKeyRange.upperBound(cutoffTime)
      let cursor = await index.openCursor(range)

      while (cursor) {
        await cursor.delete()
        deletedCount++
        cursor = await cursor.continue()
      }
    }
  }

  await tx.done
  logger.debug(`[DB] Deleted ${deletedCount} logs older than ${days} days.`)
  return deletedCount
}
