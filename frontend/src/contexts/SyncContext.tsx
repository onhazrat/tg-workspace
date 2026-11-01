/**
 * The Sync context (PVM-01, ADR-039): sync jobs and their Stop sync, the sync
 * queue, the auto-sync pause, which Channels are syncing, the restricted
 * recheck, and the two Follow operations, which both end in a First sync.
 *
 * What the Posts tab shows is the Posts view module's, never this context's:
 * a Posts field here would re-render every Channel card on every keystroke,
 * which is what splitting them fixed. Its value is memoized for the same
 * reason. `architecture-invariants.test.ts` pins its field set.
 */

import { useQueryClient } from "@tanstack/react-query"
import type React from "react"
import { createContext, useCallback, useContext, useMemo, useRef } from "react"
import { toast } from "sonner"
import {
  api,
  type BulkFollowChannelInput,
  type FollowJobStatus,
  streamFollowJobEvents,
} from "@/api"
import { addForwardedChannel } from "@/lib/channels/add-channel"
import {
  type ManualSyncMode,
  manualSyncErrorText,
  planManualSync,
} from "@/lib/channels/manual-sync"
import { logger } from "@/lib/logger"
import { useApiStatus } from "../hooks/useApiStatus"
import { type FollowOptions, useFollowJob } from "../hooks/useFollowJob"
import { type StoppableSync, useSyncJob } from "../hooks/useSyncJob"
import { useSyncQueue } from "../hooks/useSyncQueue"
import { channelAllows, disabledReason } from "../lib/channels/sync-permissions"
import type { Channel } from "../types"
import { useData } from "./DataContext"
import { invalidatePostsReads } from "./PostsViewContext"
import { useSettings } from "./SettingsContext"
import { useUI } from "./UIContext"

type SyncMode = "sync_all" | "bulk" | "individual" | "recheck_restricted"

interface SyncContextType {
  scrapingChannels: Set<string>
  setScrapingChannels: React.Dispatch<React.SetStateAction<Set<string>>>
  handleScrapeChannel: (
    channel: Channel,
    refresh?: boolean,
    source?: string,
  ) => Promise<void>
  handleScrapeAll: () => Promise<void>
  /** Syncs `names`, or the whole selection when none are given. */
  handleScrapeSelected: (names?: Set<string>) => Promise<void>
  handleRecheckRestricted: () => Promise<void>
  /** Each running Sync All or Sync selected job, for its Stop sync button. */
  runningSyncJobs: Record<StoppableSync, string | null>
  stopSync: (kind: StoppableSync) => Promise<void>
  scrapeChannelsInParallel: (
    channelsToScrape: Channel[],
    source: string,
    syncMode?: SyncMode,
    options?: SyncOptions,
  ) => Promise<void>
  syncQueue: { channel: Channel; source: string; resolve?: () => void }[]
  isProcessingQueue: boolean
  addToSyncQueue: (
    channel: Channel,
    source: string,
    resolve?: () => void,
  ) => void
  autoSyncPauseUntil: number | null
  setAutoSyncPauseUntil: React.Dispatch<React.SetStateAction<number | null>>
  consecutiveFailures: number
  setConsecutiveFailures: React.Dispatch<React.SetStateAction<number>>
  addNewChannel: (
    channelName: string,
    discoveredVia?: { channelName: string; postId: number; timestamp: number },
  ) => Promise<void>
  followDiscoverChannels: (
    channels: BulkFollowChannelInput[],
    options?: FollowOptions,
  ) => Promise<FollowJobStatus | null>
}

interface SyncOptions {
  /** Which Stop sync button holds the job. */
  stoppable?: StoppableSync
  /** Per Channel id, a moment to walk back to past held Posts (ADR-043). */
  walkBackTo?: Record<string, number>
}

/** Module-level so `useFollowJob`'s callbacks keep one identity across renders. */
const FOLLOW_API = {
  bulkFollowChannels: api.bulkFollowChannels,
  getFollowJobStatus: api.getFollowJobStatus,
  streamFollowJobEvents,
}

/** Exported so a render test can provide a value without the providers. */
export const SyncContext = createContext<SyncContextType | undefined>(undefined)

/** Recheck Restricted has no Stop sync button, so its job is not held. */
const STOP_BUTTON: Partial<Record<ManualSyncMode, StoppableSync>> = {
  sync_all: "sync_all",
  bulk: "selected",
}

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    channels,
    selectedChannels,
    setSelectedChannels,
    setChannelStats,
    loadChannels,
  } = useData()
  const { setIsRateLimited, activeTab, setActiveTab, summarizing } = useUI()
  const {
    proxyEnabled,
    defaultProxyUrls,
    torEnabled,
    torMode,
    torProxyUrls,
    torAutoRotate,
    torRotationThreshold,
    getEffectiveGlobalStartTime,
  } = useSettings()
  const { isOffline } = useApiStatus()
  const queryClient = useQueryClient()

  // A sync adds Posts without changing a query key, so only an explicit
  // invalidation makes them appear.
  const invalidatePostViews = useCallback(
    () => invalidatePostsReads(queryClient),
    [queryClient],
  )

  const {
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
  } = useSyncJob({
    isOffline,
    channelCount: channels.length,
    setIsRateLimited,
    setChannelStats,
    loadChannels,
    invalidatePostViews,
  })

  const { followDiscoverChannels } = useFollowJob({
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
    invalidatePostViews,
    waitSyncJob,
    setScrapingChannels,
    followApi: FOLLOW_API,
  })

  const scrapingLocksRef = useRef<Set<string>>(new Set())

  const handleScrapeChannel = useCallback(
    async (channel: Channel, refresh = true, source = "Manual") => {
      if (!channelAllows(channel, "individual")) {
        const reason = disabledReason(channel, "individual")
        if (reason) toast.info(reason)
        return
      }
      if (scrapingLocksRef.current.has(channel.name)) {
        logger.debug(
          `[Sync] Sync already in progress for @${channel.name}. Skipping duplicate request.`,
        )
        return
      }
      scrapingLocksRef.current.add(channel.name)
      try {
        await runServerSync(
          [channel.id],
          [channel.name],
          source,
          refresh,
          "individual",
        )
      } finally {
        scrapingLocksRef.current.delete(channel.name)
      }
    },
    [runServerSync],
  )

  const { syncQueue, addToSyncQueue, isProcessingQueue } = useSyncQueue(
    useCallback(
      async (channel, source) => {
        await handleScrapeChannel(channel, false, source)
      },
      [handleScrapeChannel],
    ),
    summarizing,
    1,
  )

  // Read when a manual sync ends, so a tab switch does not rebuild the value.
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  const value = useMemo<SyncContextType>(() => {
    const scrapeChannelsInParallel = async (
      channelsToScrape: Channel[],
      source: string,
      syncMode: SyncMode = "bulk",
      { stoppable, walkBackTo }: SyncOptions = {},
    ) => {
      if (isOffline) {
        toast.warning(
          "Server offline, sync disabled. Browsing cached data only.",
        )
        return
      }
      if (channelsToScrape.length === 0) return

      logger.debug(
        `[SyncQueue] Starting server job for ${channelsToScrape.length} channels from ${source}`,
      )
      await runServerSync(
        channelsToScrape.map((c) => c.id),
        channelsToScrape.map((c) => c.name),
        source,
        true,
        syncMode,
        stoppable,
        walkBackTo,
      )
    }

    const runManualSync = async (
      mode: ManualSyncMode,
      names: Set<string> = selectedChannels,
    ) => {
      const plan = planManualSync(mode, channels, names)
      if ("refusal" in plan) {
        toast[plan.refusal.level](plan.refusal.message)
        return
      }
      try {
        await scrapeChannelsInParallel(
          plan.channels,
          plan.source,
          plan.syncMode,
          { stoppable: STOP_BUTTON[mode] },
        )
        if (activeTabRef.current !== "channels") setActiveTab("posts")
      } catch (err: unknown) {
        console.error(err)
        toast.error(manualSyncErrorText(err, mode))
      }
    }

    return {
      scrapingChannels,
      setScrapingChannels,
      handleScrapeChannel,
      handleScrapeAll: () => runManualSync("sync_all"),
      handleScrapeSelected: (names) => runManualSync("bulk", names),
      handleRecheckRestricted: () => runManualSync("recheck_restricted"),
      runningSyncJobs,
      stopSync,
      scrapeChannelsInParallel,
      syncQueue,
      isProcessingQueue,
      addToSyncQueue,
      autoSyncPauseUntil,
      setAutoSyncPauseUntil,
      consecutiveFailures,
      setConsecutiveFailures,
      addNewChannel: (channelName, discoveredVia) =>
        addForwardedChannel(channelName, discoveredVia, {
          isOffline,
          channels,
          loadChannels,
          addToSyncQueue,
          getEffectiveGlobalStartTime,
          settings: {
            proxyEnabled,
            defaultProxyUrls,
            torEnabled,
            torMode,
            torProxyUrls,
            torAutoRotate,
            torRotationThreshold,
          },
        }),
      followDiscoverChannels,
    }
  }, [
    isOffline,
    runServerSync,
    selectedChannels,
    channels,
    setActiveTab,
    scrapingChannels,
    setScrapingChannels,
    handleScrapeChannel,
    runningSyncJobs,
    stopSync,
    syncQueue,
    isProcessingQueue,
    addToSyncQueue,
    autoSyncPauseUntil,
    setAutoSyncPauseUntil,
    consecutiveFailures,
    setConsecutiveFailures,
    loadChannels,
    getEffectiveGlobalStartTime,
    proxyEnabled,
    defaultProxyUrls,
    torEnabled,
    torMode,
    torProxyUrls,
    torAutoRotate,
    torRotationThreshold,
    followDiscoverChannels,
  ])

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync() {
  const context = useContext(SyncContext)
  if (context === undefined) {
    throw new Error("useSync must be used within a SyncProvider")
  }
  return context
}
