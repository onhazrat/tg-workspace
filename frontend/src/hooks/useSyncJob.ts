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
 * reaches consumers through `SyncContext`.
 */

import { useCallback, useState } from "react"
import { toast } from "sonner"

import { api, type SyncJobStatus, subscribeSyncJobEvents } from "@/api"
import { getChannelStats } from "@/lib/channels/store"
import { env } from "@/lib/env"
import { hasRateLimitError, mergeScrapingChannels } from "@/lib/sync/job-state"
import {
  pollSyncJob,
  runServerSync as runServerSyncWith,
  type SyncMode,
  waitSyncJob as waitSyncJobWith,
} from "@/lib/sync/run-server-sync"
import type { ChannelStats } from "@/types"

export type { SyncMode }

/**
 * The two syncs a button can stop: Sync All and Sync selected. Keyed on the
 * user's action, not the mode, because Pre-Summary, Pre-Chat and
 * Auto-Regenerate also sync as `bulk` and have no button to stop them.
 */
export type StoppableSync = "sync_all" | "selected"

const NO_RUNNING_SYNCS: Record<StoppableSync, string | null> = {
  sync_all: null,
  selected: null,
}

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
    stoppable?: StoppableSync,
  ) => Promise<void>
  /** Each stoppable sync's job id, from its start until it settles. */
  runningSyncJobs: Record<StoppableSync, string | null>
  /** Cancel that sync's job, the Channels still queued included. */
  stopSync: (kind: StoppableSync) => Promise<void>
}

/**
 * Why a held job waits (RKD-01), its kind being disabled. Shown while the
 * server sets it, so the sync does not look hung, and gone once it clears.
 */
function sayWhyItWaits(status: SyncJobStatus) {
  const id = `sync-waiting-${status.jobId}`
  if (status.waitingReason)
    toast.info(status.waitingReason, { id, duration: Number.POSITIVE_INFINITY })
  else toast.dismiss(id)
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
  const [runningSyncJobs, setRunningSyncJobs] = useState(NO_RUNNING_SYNCS)
  const holdJob = useCallback(
    (kind: StoppableSync | undefined, jobId: string | null) => {
      if (kind) setRunningSyncJobs((prev) => ({ ...prev, [kind]: jobId }))
    },
    [],
  )

  const applySyncJobStatus = useCallback(
    (status: SyncJobStatus) => {
      setScrapingChannels((prev) => mergeScrapingChannels(prev, status))
      setIsRateLimited(hasRateLimitError(status))
      sayWhyItWaits(status)
    },
    [setIsRateLimited],
  )

  const pollSyncJobFallback = useCallback(
    (jobId: string) =>
      pollSyncJob(
        {
          getStatus: api.getSyncJobStatus,
          cancel: api.cancelSyncJob,
          apply: applySyncJobStatus,
          timeoutMs: env.syncJobTimeoutMs,
          pollMs: env.syncJobFallbackPollMs,
        },
        jobId,
      ),
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
      stoppable?: StoppableSync,
    ) =>
      runServerSyncWith(
        {
          isOffline,
          channelCount,
          startSyncJob: async (request) => {
            const started = await api.startSyncJob(request)
            holdJob(stoppable, started.jobId)
            return started
          },
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
      ).finally(() => holdJob(stoppable, null)),
    [
      holdJob,
      isOffline,
      channelCount,
      waitSyncJob,
      loadChannels,
      invalidatePostViews,
      setChannelStats,
    ],
  )

  const stopSync = useCallback(
    async (kind: StoppableSync) => {
      const jobId = runningSyncJobs[kind]
      if (!jobId) return
      try {
        await api.cancelSyncJob(jobId)
        toast.info("Sync stopped")
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not stop the sync",
        )
      }
    },
    [runningSyncJobs],
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
    runningSyncJobs,
    stopSync,
  }
}
