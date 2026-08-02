import { api } from "@/api"
import type { LogType } from "@/api/data"
import { queryKeys } from "@/hooks/queryKeys"
import { queryClient } from "@/lib/queryClient"
import type {
  EmbeddingLog,
  LLMLog,
  NetworkLog,
  PublishLog,
  SyncLog,
} from "@/types"

/**
 * Append one log entry and mark the matching list stale.
 *
 * ## Why these are plain functions, not hooks
 *
 * Most callers are not React and cannot become React: `services/telegram.ts`,
 * `services/ai.ts`, `lib/network/tor-actions.ts`, `lib/channels/add-channel.ts`
 * and `lib/channels/refresh-metadata.ts` all log from inside plain async
 * service functions. The point of A3 is deleting the IndexedDB cache and the
 * etag-staleness layer, not routing every write through a component.
 *
 * ## Why a failed write does not throw
 *
 * **This is a deliberate behaviour change.** `repository.ts`'s `apiWrite`
 * rethrew after falling back to IndexedDB, so the entry survived locally and
 * the throw was recoverable. With the mirror gone there is nothing to fall back
 * to, and rethrowing would make a failed *log* break the operation that
 * produced it — a proxy test that worked would report as failed because
 * recording it did not. Several call sites already do not await these
 * (`saveNetworkLog(entry)` in `add-channel.ts`, `refresh-metadata.ts`), so a
 * rejection there is an unhandled promise rejection, not an error anyone sees.
 *
 * Logging is incidental to every one of these operations. A write that fails is
 * reported to the console and otherwise ignored.
 */
export type LogPoster = (type: LogType, logs: unknown[]) => Promise<unknown>

/**
 * The `post` parameter is a **test seam**, not an extension point.
 *
 * `src/lib/repository.posts.test.ts` calls `mock.module("@/api", …)`, and
 * Bun's module mocks are process-wide rather than file-scoped — so a test that
 * spied on `api.createLogs` would observe that other file's stub once the whole
 * suite runs in one process, and pass in isolation while failing in the suite.
 * Injecting the writer is the pattern this repo already settled on for exactly
 * this (see `fetchAllPostsFromServer`'s `fetchPage`). Production callers never
 * pass it.
 */
export async function writeLog(
  type: LogType,
  log: unknown,
  post: LogPoster = api.createLogs,
): Promise<void> {
  try {
    await post(type, [log])
  } catch (error) {
    console.warn(`[logs] failed to record a ${type} log entry`, error)
    return
  }
  // Only invalidate on success: marking the list stale after a failed write
  // would send the next reader to a server that just rejected us, for data that
  // was never written.
  await queryClient.invalidateQueries({ queryKey: queryKeys.logs[type] })
}

export const savePublishLog = (
  log: PublishLog,
  post?: LogPoster,
): Promise<void> => writeLog("publish", log, post)

export const saveSyncLog = (log: SyncLog, post?: LogPoster): Promise<void> =>
  writeLog("sync", log, post)

export const saveLLMLog = (log: LLMLog, post?: LogPoster): Promise<void> =>
  writeLog("llm", log, post)

export const saveEmbeddingLog = (
  log: EmbeddingLog,
  post?: LogPoster,
): Promise<void> => writeLog("embedding", log, post)

export const saveNetworkLog = (
  log: NetworkLog,
  post?: LogPoster,
): Promise<void> => writeLog("network", log, post)
