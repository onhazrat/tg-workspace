import { useQueryClient } from "@tanstack/react-query"
import React, { createContext, useCallback, useContext } from "react"
import { toast } from "sonner"
import {
  api,
  type BulkFollowChannelInput,
  type FollowJobStatus,
  streamFollowJobEvents,
} from "@/api"
import type { PromptScope } from "@/api/data"
import type { ScopeSubmission } from "@/client"
import { addForwardedChannel } from "@/lib/channels/add-channel"
import {
  type ManualSyncMode,
  manualSyncErrorText,
  planManualSync,
} from "@/lib/channels/manual-sync"
import { logger } from "@/lib/logger"
import { useApiStatus } from "../hooks/useApiStatus"
import { useFollowJob } from "../hooks/useFollowJob"
import { usePostFilters } from "../hooks/usePostFilters"
import { usePromptPosts } from "../hooks/usePromptPosts"
import { useSyncJob } from "../hooks/useSyncJob"
import { useSyncQueue } from "../hooks/useSyncQueue"
import { channelAllows, disabledReason } from "../lib/channels/sync-permissions"
import type {
  MaxPostsPerChannelMode,
  MediaFilterValue,
  PostSortOrder,
  PostViewOptions,
} from "../lib/posts/post-view"
import type { Channel, Post } from "../types"
import { useData } from "./DataContext"
import { useRAG } from "./RAGContext"
import { useScope } from "./ScopeContext"
import { useSettings } from "./SettingsContext"
import { useUI } from "./UIContext"

interface ScraperContextType {
  postSearch: string
  setPostSearch: React.Dispatch<React.SetStateAction<string>>
  semanticSearchQuery: string
  setSemanticSearchQuery: React.Dispatch<React.SetStateAction<string>>
  semanticSearchRespectsChannels: boolean
  setSemanticSearchRespectsChannels: React.Dispatch<
    React.SetStateAction<boolean>
  >
  relatedPostSearch: Post | null
  setRelatedPostSearch: React.Dispatch<React.SetStateAction<Post | null>>
  scrapingChannels: Set<string>
  setScrapingChannels: React.Dispatch<React.SetStateAction<Set<string>>>
  /** Refresh the server-backed post views (feed / counts / Discover). */
  handleFilterPosts: () => Promise<void>
  /**
   * The same refresh, without the command-palette shape.
   *
   * `handleFilterPosts` is what a command or an "apply" button calls and is
   * async because those callers await it. The Live-window timer (AW-04) is
   * neither: it refreshes on a clock, has nothing to await, and reads better
   * saying what it does.
   */
  invalidatePostViews: () => void
  /**
   * Fetch the current scope's filtered posts on demand — the set the Posts
   * view holds for the same inputs — without writing state. Consumers that
   * only need posts at action time (summary/chat/tag/pickers) call this.
   */
  getScopedPosts: (
    searchText?: string,
    semanticQuery?: string,
  ) => Promise<Post[]>
  /**
   * The posts input for an AI endpoint: a server-side `scope` (backend
   * assembles), or client-fetched `posts` for the semantic/related path.
   */
  getPromptPostsInput: () => Promise<
    | { posts: Post[]; scope?: undefined }
    | { posts?: undefined; scope: PromptScope }
  >
  /**
   * The current Scope as an Action submits it, for the server to freeze
   * (AW-05). See `usePromptPosts`.
   */
  getScopeSubmission: (channels: string[], posts?: Post[]) => ScopeSubmission
  handleScrapeChannel: (
    channel: Channel,
    refresh?: boolean,
    source?: string,
  ) => Promise<void>
  handleScrapeAll: () => Promise<void>
  handleScrapeSelected: () => Promise<void>
  handleRecheckRestricted: () => Promise<void>
  scrapeChannelsInParallel: (
    channelsToScrape: Channel[],
    source: string,
    syncMode?: "sync_all" | "bulk" | "individual" | "recheck_restricted",
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
    options?: {
      onProgress?: (status: FollowJobStatus) => void
    },
  ) => Promise<FollowJobStatus | null>
  forwardedFilter: "all" | "forwarded" | "original" | "unfollowed_forwarded"
  setForwardedFilter: React.Dispatch<
    React.SetStateAction<
      "all" | "forwarded" | "original" | "unfollowed_forwarded"
    >
  >
  mediaFilter: MediaFilterValue
  setMediaFilter: React.Dispatch<React.SetStateAction<MediaFilterValue>>
  maxPostsPerChannel: number
  setMaxPostsPerChannel: React.Dispatch<React.SetStateAction<number>>
  maxPostsPerChannelMode: MaxPostsPerChannelMode
  setMaxPostsPerChannelMode: React.Dispatch<
    React.SetStateAction<MaxPostsPerChannelMode>
  >
  postSortOrder: PostSortOrder
  setPostSortOrder: React.Dispatch<React.SetStateAction<PostSortOrder>>
  postViewOptions: PostViewOptions
}

/** Module-level so `useFollowJob`'s callbacks keep one identity across renders. */
const FOLLOW_API = {
  bulkFollowChannels: api.bulkFollowChannels,
  getFollowJobStatus: api.getFollowJobStatus,
  streamFollowJobEvents,
}

const ScraperContext = createContext<ScraperContextType | undefined>(undefined)

export const ScraperProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    channels,
    selectedChannels,
    setSelectedChannels,
    setChannelStats,
    loadChannels,
  } = useData()
  const { startDate, endDate, windowKey } = useScope()
  const { setIsRateLimited, activeTab, setActiveTab, summarizing } = useUI()
  const {
    proxyEnabled,
    defaultProxyUrls,
    torEnabled,
    torMode,
    torProxyUrls,
    torAutoRotate,
    torRotationThreshold,
    embeddingsEnabled,
    getEffectiveGlobalStartTime,
  } = useSettings()
  const { searchSimilarPosts } = useRAG()
  const { isOffline } = useApiStatus()
  const queryClient = useQueryClient()

  // Refetch the server-backed post views (feed, per-channel counts, Discover)
  // after a sync adds posts — a sync changes no scope/filter, so the query keys
  // are unchanged and only an explicit invalidation makes new posts appear.
  // Prefixes must match queryKeys.postsFeed / postsCounts / discoverCandidates.
  const invalidatePostViews = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["postsFeed"] })
    queryClient.invalidateQueries({ queryKey: ["postsCounts"] })
    queryClient.invalidateQueries({ queryKey: ["discoverCandidates"] })
  }, [queryClient])

  const {
    postSearch,
    setPostSearch,
    semanticSearchQuery,
    setSemanticSearchQuery,
    semanticSearchRespectsChannels,
    setSemanticSearchRespectsChannels,
    relatedPostSearch,
    setRelatedPostSearch,
    forwardedFilter,
    setForwardedFilter,
    mediaFilter,
    setMediaFilter,
    maxPostsPerChannel,
    setMaxPostsPerChannel,
    maxPostsPerChannelMode,
    setMaxPostsPerChannelMode,
    postSortOrder,
    setPostSortOrder,
    postViewOptions,
    debouncedPostSearch,
    debouncedSemanticSearchQuery,
  } = usePostFilters()

  const {
    scrapingChannels,
    setScrapingChannels,
    autoSyncPauseUntil,
    setAutoSyncPauseUntil,
    consecutiveFailures,
    setConsecutiveFailures,
    waitSyncJob,
    runServerSync,
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

  const { getScopedPosts, getPromptPostsInput, getScopeSubmission } =
    usePromptPosts({
      channels,
      selectedChannels,
      startDate,
      endDate,
      windowKey,
      embeddingsEnabled,
      debouncedPostSearch,
      debouncedSemanticSearchQuery,
      relatedPostSearch,
      forwardedFilter,
      mediaFilter,
      postViewOptions,
      semanticSearchRespectsChannels,
      searchSimilarPosts,
      getPostsFeed: api.getPostsFeed,
    })

  const scrapingLocksRef = React.useRef<Set<string>>(new Set())

  // Refresh the post views. The feed / counts / Discover are react-query
  // backed and refetch on their own when the scope or filter state changes;
  // callers that flip a filter and then "apply" it, and the post-sync paths,
  // call this to force a fresh fetch. No eager array is populated any more —
  // consumers read the server feed (usePostsFeed) or getScopedPosts on demand.
  const handleFilterPosts = useCallback(async () => {
    invalidatePostViews()
  }, [invalidatePostViews])

  const handleScrapeChannel = useCallback(
    async (channel: Channel, refresh = true, source = "Manual") => {
      if (!channelAllows(channel, "individual")) {
        const reason = disabledReason(channel, "individual")
        if (reason) toast.info(reason)
        return
      }
      if (scrapingLocksRef.current.has(channel.name)) {
        logger.debug(
          `[Scraper] Sync already in progress for @${channel.name}. Skipping duplicate request.`,
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

  const scrapeChannelsInParallel = async (
    channelsToScrape: Channel[],
    source: string,
    syncMode:
      | "sync_all"
      | "bulk"
      | "individual"
      | "recheck_restricted" = "bulk",
  ) => {
    if (isOffline) {
      toast.warning(
        "Server offline — sync disabled. Browsing cached data only.",
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
    )
  }

  const runManualSync = async (mode: ManualSyncMode) => {
    const plan = planManualSync(mode, channels, selectedChannels)
    if ("refusal" in plan) {
      toast[plan.refusal.level](plan.refusal.message)
      return
    }
    try {
      await scrapeChannelsInParallel(plan.channels, plan.source, plan.syncMode)
      if (activeTab !== "channels") setActiveTab("posts")
    } catch (err: unknown) {
      console.error(err)
      toast.error(manualSyncErrorText(err, mode))
    }
  }

  const handleScrapeAll = () => runManualSync("sync_all")
  const handleScrapeSelected = () => runManualSync("bulk")
  const handleRecheckRestricted = () => runManualSync("recheck_restricted")

  const addNewChannel = (
    channelName: string,
    discoveredVia?: { channelName: string; postId: number; timestamp: number },
  ) =>
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
    })

  return (
    <ScraperContext.Provider
      value={{
        postSearch,
        setPostSearch,
        semanticSearchQuery,
        setSemanticSearchQuery,
        semanticSearchRespectsChannels,
        setSemanticSearchRespectsChannels,
        relatedPostSearch,
        setRelatedPostSearch,
        scrapingChannels,
        setScrapingChannels,
        handleFilterPosts,
        invalidatePostViews,
        getScopedPosts,
        getPromptPostsInput,
        getScopeSubmission,
        handleScrapeChannel,
        handleScrapeAll,
        handleScrapeSelected,
        handleRecheckRestricted,
        scrapeChannelsInParallel,
        syncQueue,
        isProcessingQueue,
        addToSyncQueue,
        autoSyncPauseUntil,
        setAutoSyncPauseUntil,
        consecutiveFailures,
        setConsecutiveFailures,
        addNewChannel,
        followDiscoverChannels,
        forwardedFilter,
        setForwardedFilter,
        mediaFilter,
        setMediaFilter,
        maxPostsPerChannel,
        setMaxPostsPerChannel,
        maxPostsPerChannelMode,
        setMaxPostsPerChannelMode,
        postSortOrder,
        setPostSortOrder,
        postViewOptions,
      }}
    >
      {children}
    </ScraperContext.Provider>
  )
}

export function useScraper() {
  const context = useContext(ScraperContext)
  if (context === undefined) {
    throw new Error("useScraper must be used within a ScraperProvider")
  }
  return context
}
