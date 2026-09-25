/**
 * Owns one job: a server-side channel sync (G1).
 *
 * Extracted from `ScraperContext`, which was 1,103 lines and five
 * responsibilities. This is the watcher half — start a job, follow it over SSE,
 * fall back to polling, reconcile the result — plus the state that only the
 * watcher writes: which channels are in flight, and the consecutive-failure
 * backoff.
 *
 * The *decisions* it makes about a `SyncJobStatus` live in `lib/sync/job-state.ts`
 * and were extracted first, under T2, precisely so this move had a safety net.
 * Nothing here re-implements them.
 *
 * Deliberately a hook rather than a context: nothing outside the scrape
 * orchestration reads `runServerSync` or `waitSyncJob`, and `scrapingChannels`
 * reaches consumers through `ScraperContext` as it always has.
 */

import { useCallback, useState } from "react"
import { toast } from "sonner"

import { api, type SyncJobStatus, subscribeSyncJobEvents } from "@/api"
import { getChannelStats } from "@/lib/channels/store"
import { env } from "@/lib/env"
import {
  hasRateLimitError,
  isTerminalSyncStatus,
  mergeScrapingChannels,
} from "@/lib/sync/job-state"
import {
  runServerSync as runServerSyncWith,
  SYNC_TIMED_OUT_MESSAGE,
  type SyncMode,
  waitSyncJob as waitSyncJobWith,
} from "@/lib/sync/run-server-sync"
import type { ChannelStats } from "@/types"

export type { SyncMode }

export interface SyncJobDeps {
  isOffline: boolean
  /**
   * Total followed channels. Only the failure threshold uses it — auto-sync
   * pauses after `max(3, channelCount)` consecutive failures, so a large
   * account is not paused by a handful of bad handles.
   */
  channelCount: number
  setIsRateLimited: (rateLimited: boolean) => void
  setChannelStats: React.Dispatch<
    React.SetStateAction<Record<string, ChannelStats>>
  >
  loadChannels: () => Promise<void>
  /** Refetch the server-backed post views once a sync has added rows. */
  invalidatePostViews: () => void
}

export interface SyncJob {
  scrapingChannels: Set<string>
  setScrapingChannels: React.Dispatch<React.SetStateAction<Set<string>>>
  autoSyncPauseUntil: number | null
  setAutoSyncPauseUntil: React.Dispatch<React.SetStateAction<number | null>>
  consecutiveFailures: number
  setConsecutiveFailures: React.Dispatch<React.SetStateAction<number>>
  /** Follow a job to a terminal state, over SSE with a polling fallback. */
  waitSyncJob: (jobId: string) => Promise<SyncJobStatus>
  /** Start a job and reconcile its result. */
  runServerSync: (
    channelIds: string[],
    channelNames: string[],
    source: string,
    refresh?: boolean,
    syncMode?: SyncMode,
  ) => Promise<void>
}

export function useSyncJob(deps: SyncJobDeps): SyncJob {
  const {
    isOffline,
    channelCount,
    setIsRateLimited,
    setChannelStats,
    loadChannels,
    invalidatePostViews,
  } = deps

  const [scrapingChannels, setScrapingChannels] = useState<Set<string>>(
    new Set(),
  )
  const [autoSyncPauseUntil, setAutoSyncPauseUntil] = useState<number | null>(
    null,
  )
  const [consecutiveFailures, setConsecutiveFailures] = useState<number>(0)

  const applySyncJobStatus = useCallback(
    (status: SyncJobStatus) => {
      setScrapingChannels((prev) => mergeScrapingChannels(prev, status))
      setIsRateLimited(hasRateLimitError(status))
    },
    [setIsRateLimited],
  )

  const pollSyncJobFallback = useCallback(
    async (jobId: string) => {
      const deadline = Date.now() + env.syncJobTimeoutMs
      while (Date.now() < deadline) {
        const status = await api.getSyncJobStatus(jobId)
        applySyncJobStatus(status)
        if (isTerminalSyncStatus(status.status)) {
          return status
        }
        await new Promise((resolve) =>
          setTimeout(resolve, env.syncJobFallbackPollMs),
        )
      }
      await api.cancelSyncJob(jobId)
      throw new Error(SYNC_TIMED_OUT_MESSAGE)
    },
    [applySyncJobStatus],
  )

  const waitSyncJob = useCallback(
    (jobId: string) =>
      waitSyncJobWith(
        {
          subscribe: subscribeSyncJobEvents,
          getStatus: api.getSyncJobStatus,
          cancel: api.cancelSyncJob,
          apply: applySyncJobStatus,
          pollFallback: pollSyncJobFallback,
          timeoutMs: env.syncJobTimeoutMs,
        },
        jobId,
      ),
    [applySyncJobStatus, pollSyncJobFallback],
  )

  const runServerSync = useCallback(
    (
      channelIds: string[],
      channelNames: string[],
      source: string,
      refresh = true,
      syncMode: SyncMode = "bulk",
    ) =>
      runServerSyncWith(
        {
          isOffline,
          channelCount,
          startSyncJob: api.startSyncJob,
          waitSyncJob,
          getChannelStats: (channelId) => getChannelStats(channelId),
          loadChannels,
          invalidatePostViews,
          setScrapingChannels,
          setChannelStats,
          setConsecutiveFailures,
          setAutoSyncPauseUntil,
          notify: toast,
          now: Date.now,
        },
        { channelIds, channelNames, source, refresh, syncMode },
      ),
    [
      isOffline,
      channelCount,
      waitSyncJob,
      loadChannels,
      invalidatePostViews,
      setChannelStats,
    ],
  )

  return {
    scrapingChannels,
    setScrapingChannels,
    autoSyncPauseUntil,
    setAutoSyncPauseUntil,
    consecutiveFailures,
    setConsecutiveFailures,
    waitSyncJob,
    runServerSync,
  }
}
