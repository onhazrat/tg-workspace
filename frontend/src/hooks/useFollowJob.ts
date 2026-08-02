/**
 * Owns one job: bulk-following channels found in Discover (G1).
 *
 * Extracted from `ScraperContext` alongside {@link useSyncJob}. It is a
 * separate hook rather than part of that one because it is a genuinely
 * different job with its own endpoint, its own SSE stream and its own result
 * shape — but it *chains into* a sync job, so it takes `waitSyncJob` and
 * `setScrapingChannels` from `useSyncJob` rather than duplicating them.
 *
 * That chaining is the reason the two hooks are ordered: the follow job's
 * response may carry a `syncJobId` for the channels it just created, and the
 * user should see those channels syncing without a second click.
 */

import { useCallback } from "react"
import { toast } from "sonner"

import {
  api,
  type BulkFollowChannelInput,
  type FollowJobStatus,
  type SyncJobStatus,
  streamFollowJobEvents,
} from "@/api"
import { getChannelStats } from "@/lib/channels/store"
import { env } from "@/lib/env"
import { createdChannelNamesFromResults } from "@/lib/posts/discover-selection"
import { isTerminalSyncStatus } from "@/lib/sync/job-state"
import {
  buildActiveProxies,
  isNetworkRoutingActive,
  type ProxySettings,
} from "@/lib/syncSettings"
import type { ChannelStats } from "@/types"

/**
 * Extends `ProxySettings` rather than restating its five fields — restating
 * them is how `defaultProxyUrls` ends up typed `string[]` when it is a
 * newline/comma-separated `string`, which is exactly what happened here first.
 */
export interface FollowJobDeps extends ProxySettings {
  isOffline: boolean
  torAutoRotate: boolean
  torRotationThreshold: number
  setSelectedChannels: React.Dispatch<React.SetStateAction<Set<string>>>
  setChannelStats: React.Dispatch<
    React.SetStateAction<Record<string, ChannelStats>>
  >
  loadChannels: () => Promise<void>
  loadSyncLogs: () => Promise<void>
  invalidatePostViews: () => void
  /** From `useSyncJob` — the follow job chains into a sync job. */
  waitSyncJob: (jobId: string) => Promise<SyncJobStatus>
  setScrapingChannels: React.Dispatch<React.SetStateAction<Set<string>>>
}

export interface FollowJob {
  followDiscoverChannels: (
    channels: BulkFollowChannelInput[],
    options?: { onProgress?: (status: FollowJobStatus) => void },
  ) => Promise<FollowJobStatus | null>
}

export function useFollowJob(deps: FollowJobDeps): FollowJob {
  const {
    isOffline,
    proxyEnabled,
    defaultProxyUrls,
    torEnabled,
    torMode,
    torProxyUrls,
    torAutoRotate,
    torRotationThreshold,
    setSelectedChannels,
    setChannelStats,
    loadChannels,
    loadSyncLogs,
    invalidatePostViews,
    waitSyncJob,
    setScrapingChannels,
  } = deps

  /**
   * Follow a bulk-follow job to a terminal state.
   *
   * Note this does **not** share `waitSyncJob`'s polling fallback: the two
   * differ in what a timeout means. A sync job that outlives its deadline is
   * cancelled server-side; a follow job is not, because cancelling half-way
   * through would leave channels partially created.
   */
  const waitFollowJob = useCallback(
    async (
      followJobId: string,
      onProgress?: (status: FollowJobStatus) => void,
    ) => {
      const abortController = new AbortController()
      const timeoutId = window.setTimeout(
        () => abortController.abort(),
        env.syncJobTimeoutMs,
      )

      try {
        for await (const status of streamFollowJobEvents(
          followJobId,
          abortController.signal,
        )) {
          onProgress?.(status)
          if (isTerminalSyncStatus(status.status)) {
            return status
          }
        }
        const finalStatus = await api.getFollowJobStatus(followJobId)
        onProgress?.(finalStatus)
        return finalStatus
      } catch (err) {
        if (abortController.signal.aborted) {
          throw new Error("Follow job timed out")
        }
        console.warn(
          "[Scraper] SSE follow progress failed, falling back to polling:",
          err,
        )
        const deadline = Date.now() + env.syncJobTimeoutMs
        while (Date.now() < deadline) {
          const status = await api.getFollowJobStatus(followJobId)
          onProgress?.(status)
          if (isTerminalSyncStatus(status.status)) {
            return status
          }
          await new Promise((resolve) =>
            setTimeout(resolve, env.syncJobFallbackPollMs),
          )
        }
        throw new Error("Follow job timed out")
      } finally {
        window.clearTimeout(timeoutId)
      }
    },
    [],
  )

  const followDiscoverChannels = useCallback(
    async (
      channelsToFollow: BulkFollowChannelInput[],
      options?: {
        onProgress?: (status: FollowJobStatus) => void
      },
    ): Promise<FollowJobStatus | null> => {
      if (isOffline) {
        toast.warning("Server offline — cannot follow channels while offline.")
        return null
      }
      if (channelsToFollow.length === 0) return null

      const activeProxies = buildActiveProxies({
        proxyEnabled,
        defaultProxyUrls,
        torEnabled,
        torMode,
        torProxyUrls,
      })

      const followingNames = channelsToFollow.map((c) => c.name)
      setScrapingChannels((prev) => {
        const next = new Set(prev)
        followingNames.forEach((n) => next.add(n))
        return next
      })

      try {
        const { followJobId } = await api.bulkFollowChannels({
          channels: channelsToFollow,
          proxyEnabled: isNetworkRoutingActive({
            proxyEnabled,
            defaultProxyUrls,
            torEnabled,
            torMode,
            torProxyUrls,
          }),
          proxies: activeProxies,
          torAutoRotate,
          torRotationThreshold,
        })

        const followStatus = await waitFollowJob(
          followJobId,
          options?.onProgress,
        )

        const createdNames = createdChannelNamesFromResults(
          followStatus.results,
        )
        if (createdNames.length > 0) {
          setSelectedChannels((prev) => {
            const next = new Set(prev)
            for (const name of createdNames) next.add(name)
            return next
          })
        }

        await loadChannels()

        const parts: string[] = []
        if (followStatus.added > 0) parts.push(`${followStatus.added} added`)
        if (followStatus.unavailable > 0)
          parts.push(`${followStatus.unavailable} unavailable`)
        if (followStatus.skipped > 0)
          parts.push(`${followStatus.skipped} skipped`)
        if (followStatus.failed > 0) parts.push(`${followStatus.failed} failed`)
        const summary =
          parts.length > 0
            ? `Follow finished: ${parts.join(", ")}`
            : "Follow finished"

        if (followStatus.failed > 0 && followStatus.added === 0) {
          toast.error(summary)
        } else if (followStatus.unavailable > 0 && followStatus.added === 0) {
          toast.warning(summary, { duration: 8000 })
        } else {
          toast.success(summary)
        }

        if (followStatus.syncJobId) {
          const channelNames = followStatus.results
            .filter((r) => r.status === "added")
            .map((r) => r.name)
          setScrapingChannels(new Set(channelNames))
          const syncResult = await waitSyncJob(followStatus.syncJobId)
          const successes = syncResult.channels.filter(
            (ch) => ch.status === "success",
          )
          for (const ch of successes) {
            const s = await getChannelStats(ch.channelId)
            if (s) {
              setChannelStats((prev) => ({
                ...prev,
                [ch.channelName]: { ...s, latestId: ch.newLatestId },
              }))
            }
          }
          await loadChannels()
          await loadSyncLogs()
          invalidatePostViews()
        }

        return followStatus
      } catch (err) {
        console.error("[Scraper] Discover bulk follow failed:", err)
        toast.error(err instanceof Error ? err.message : "Bulk follow failed")
        return null
      } finally {
        setScrapingChannels((prev) => {
          const next = new Set(prev)
          followingNames.forEach((n) => next.delete(n))
          return next
        })
      }
    },
    [
      isOffline,
      proxyEnabled,
      defaultProxyUrls,
      torEnabled,
      torMode,
      torProxyUrls,
      torAutoRotate,
      torRotationThreshold,
      waitFollowJob,
      waitSyncJob,
      setSelectedChannels,
      loadChannels,
      loadSyncLogs,
      invalidatePostViews,
      setChannelStats,
    ],
  )

  return { followDiscoverChannels }
}
