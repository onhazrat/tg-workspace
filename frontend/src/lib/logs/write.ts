import { api } from "@/api"
import type { LogType } from "@/api/data"
import { queryKeys } from "@/hooks/queryKeys"
import { selectedAiKeyId } from "@/lib/aiKeys/selection"
import type { AiKey } from "@/lib/aiKeys/store"
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

/**
 * Which Provider this account's next AI call goes to, from the cached Key list.
 *
 * Read out of the query cache rather than through `useAiKeys`, because two of
 * the three callers below are plain async functions inside contexts and one is
 * not React at all — the same reason `writeLog` is a function and not a hook.
 *
 * A miss (cache cold, or the Key deleted since) leaves both fields undefined,
 * which is what `null` means on the column: nothing was recorded, rather than a
 * guess. The server never trusts these — they are provenance for the reader,
 * and the scheduler stamps its own from the Key it actually resolved.
 */
function currentProvider(): Pick<LLMLog, "provider" | "baseUrl"> {
  const selected = selectedAiKeyId()
  // **Only an explicit selection.** There was a `?? keys[0]` fallback here and
  // it was worse than nothing: with no id in the body the server resolves
  // `(validated or rows)[0]` — validated Keys first — while `keys[0]` is merely
  // the most recently updated. Hold a validated Gemini Key updated yesterday
  // and an OpenAI-compatible one whose stamp a rejection cleared today, select
  // neither, and the server bills Gemini while the row claims the other. That
  // is the "which Provider is failing me" question these columns exist for,
  // answered wrong, which is worse than left blank.
  //
  // Mirroring the server's rule here instead would be the same rule in two
  // places, drifting the moment either moves. `null` already means "nothing was
  // recorded".
  if (!selected) return {}
  const key = queryClient
    .getQueryData<AiKey[]>(queryKeys.aiKeys)
    ?.find((k) => k.id === selected)
  if (!key) return {}
  return { provider: key.provider, baseUrl: key.baseUrl ?? undefined }
}

/**
 * Record one AI call, with the Provider it went to (BYOK-03).
 *
 * The provenance is stamped **here** rather than at each of the three call
 * sites, so a fourth Artifact kind gets it by writing its log at all. The
 * prompt and response still come from the caller: this only adds what the
 * caller would have had to look up identically three times.
 */
export const saveLLMLog = (log: LLMLog, post?: LogPoster): Promise<void> =>
  writeLog("llm", { ...currentProvider(), ...log }, post)

export const saveEmbeddingLog = (
  log: EmbeddingLog,
  post?: LogPoster,
): Promise<void> => writeLog("embedding", log, post)

export const saveNetworkLog = (
  log: NetworkLog,
  post?: LogPoster,
): Promise<void> => writeLog("network", log, post)
