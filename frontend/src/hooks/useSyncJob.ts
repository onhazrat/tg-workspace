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
import { logger } from "@/lib/logger"
import {
  deriveScrapingChannels,
  hasRateLimitError,
  isTerminalSyncStatus,
  shouldFallBackToPolling,
} from "@/lib/sync/job-state"
import type { ChannelStats } from "@/types"

/** How the sync was triggered; the server records it on the job. */
export type SyncMode = "sync_all" | "bulk" | "individual" | "recheck_restricted"

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
      setScrapingChannels(deriveScrapingChannels(status))
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
      throw new Error("Sync job timed out")
    },
    [applySyncJobStatus],
  )

  const waitSyncJob = useCallback(
    async (jobId: string) => {
      const abortController = new AbortController()
      const timeoutId = window.setTimeout(
        () => abortController.abort(),
        env.syncJobTimeoutMs,
      )

      try {
        for await (const status of subscribeSyncJobEvents(
          jobId,
          abortController.signal,
        )) {
          applySyncJobStatus(status)
          if (isTerminalSyncStatus(status.status)) {
            return status
          }
        }
        const finalStatus = await api.getSyncJobStatus(jobId)
        applySyncJobStatus(finalStatus)
        return finalStatus
      } catch (err) {
        if (!shouldFallBackToPolling(abortController.signal.aborted)) {
          await api.cancelSyncJob(jobId)
          throw new Error("Sync job timed out")
        }
        console.warn(
          "[Scraper] SSE sync progress failed, falling back to polling:",
          err,
        )
        return pollSyncJobFallback(jobId)
      } finally {
        window.clearTimeout(timeoutId)
      }
    },
    [applySyncJobStatus, pollSyncJobFallback],
  )

  const runServerSync = useCallback(
    async (
      channelIds: string[],
      channelNames: string[],
      source: string,
      refresh = true,
      syncMode: SyncMode = "bulk",
    ) => {
      if (isOffline) {
        toast.warning(
          "Server offline — sync disabled. Browsing cached data only.",
        )
        return
      }
      if (channelIds.length === 0) return

      logger.debug(
        `[Scraper] Starting server sync for ${channelIds.length} channel(s) from ${source}`,
      )
      setScrapingChannels((prev) => {
        const next = new Set(prev)
        channelNames.forEach((n) => next.add(n))
        return next
      })

      try {
        let jobId: string
        try {
          ;({ jobId } = await api.startSyncJob({
            channelIds,
            source,
            syncMode,
          }))
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (message.includes("No channels to sync")) {
            toast.error(
              "No channels available to sync. Try re-adding the channel or run the user_id backfill script.",
            )
          }
          throw err
        }
        const result = await waitSyncJob(jobId)

        const failures = result.channels.filter((ch) => ch.status === "failed")
        const successes = result.channels.filter(
          (ch) => ch.status === "success",
        )

        if (successes.length > 0) {
          setConsecutiveFailures(0)
          setAutoSyncPauseUntil(null)
          for (const ch of successes) {
            const s = await getChannelStats(ch.channelId)
            if (s) {
              setChannelStats((prev) => ({
                ...prev,
                [ch.channelName]: { ...s, latestId: ch.newLatestId },
              }))
            }
          }
        }

        if (failures.length > 0) {
          setConsecutiveFailures((prev) => {
            const next = prev + failures.length
            if (next >= Math.max(3, channelCount)) {
              setAutoSyncPauseUntil(Date.now() + 10 * 60 * 1000)
              toast.error(
                "Auto-sync paused for 10 minutes due to consecutive failures.",
              )
            }
            return next
          })
          const firstErr = failures[0]?.error || "Sync failed"
          if (failures.length === 1) {
            toast.error(
              `Sync failed for @${failures[0].channelName}: ${firstErr}`,
            )
          } else {
            toast.error(`${failures.length} channel sync(s) failed`)
          }
        }

        // Always reload channels so resolved startId appears after first sync.
        await loadChannels()
        if (refresh) {
          invalidatePostViews()
        }

        if (failures.length > 0 && successes.length === 0) {
          throw new Error(failures[0].error || "Sync failed")
        }
      } finally {
        setScrapingChannels((prev) => {
          const next = new Set(prev)
          channelNames.forEach((n) => next.delete(n))
          return next
        })
      }
    },
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
