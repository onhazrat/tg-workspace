import { useQueryClient } from "@tanstack/react-query"
import React, { createContext, useCallback, useContext, useEffect } from "react"
import { toast } from "sonner"
import { api, type BulkFollowChannelInput, type FollowJobStatus } from "@/api"
import type { PromptScope } from "@/api/data"
import { parseApiError, unavailableChannelToastMessage } from "@/lib/api-errors"
import { logger } from "@/lib/logger"
import { useApiStatus } from "../hooks/useApiStatus"
import { useFollowJob } from "../hooks/useFollowJob"
import { usePostFilters } from "../hooks/usePostFilters"
import { usePromptPosts } from "../hooks/usePromptPosts"
import { useSyncJob } from "../hooks/useSyncJob"
import { useSyncQueue } from "../hooks/useSyncQueue"
import {
  channelAllows,
  disabledReason,
  filterChannelsForOperation,
} from "../lib/channels/sync-permissions"
import {
  detectLanguageFromPosts,
  LANGUAGE_DETECTION_LOOKBACK_MS,
  LANGUAGE_DETECTION_SAMPLE_SIZE,
  selectChannelsForLanguageDetection,
} from "../lib/language"
import type {
  MaxPostsPerChannelMode,
  MediaFilterValue,
  PostSortOrder,
  PostViewOptions,
} from "../lib/posts/post-view"
import { upsertChannel } from "../lib/repository"
import { buildActiveProxies, isNetworkRoutingActive } from "../lib/syncSettings"
import type { Channel, Post } from "../types"
import { useData } from "./DataContext"
import { useRAG } from "./RAGContext"
import { useSettings } from "./SettingsContext"
import { useUI } from "./UIContext"

interface ScraperContextType {
  postSearch: string
  setPostSearch: React.Dispatch<React.SetStateAction<string>>
  semanticSearchQuery: string
  setSemanticSearchQuery: React.Dispatch<React.SetStateAction<string>>
  semanticSearchRespectsTimeRange: boolean
  setSemanticSearchRespectsTimeRange: React.Dispatch<
    React.SetStateAction<boolean>
  >
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
    loadSyncLogs,
  } = useData()
  const {
    startDate,
    endDate,
    setIsRateLimited,
    activeTab,
    setActiveTab,
    summarizing,
  } = useUI()
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
    semanticSearchRespectsTimeRange,
    setSemanticSearchRespectsTimeRange,
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
    loadSyncLogs,
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
    loadSyncLogs,
    invalidatePostViews,
    waitSyncJob,
    setScrapingChannels,
  })

  const { getScopedPosts, getPromptPostsInput } = usePromptPosts({
    channels,
    selectedChannels,
    startDate,
    endDate,
    embeddingsEnabled,
    debouncedPostSearch,
    debouncedSemanticSearchQuery,
    relatedPostSearch,
    forwardedFilter,
    mediaFilter,
    postViewOptions,
    semanticSearchRespectsTimeRange,
    semanticSearchRespectsChannels,
    searchSimilarPosts,
    getPostsFeed: api.getPostsFeed,
  })

  const scrapingLocksRef = React.useRef<Set<string>>(new Set())
  const attemptedLanguageDetectionRef = React.useRef<Set<string>>(new Set())

  // Background language detection for existing channels.
  //
  // This effect re-arms whenever `channels` changes identity — including from
  // the `loadChannels()` it ends with. `attemptedLanguageDetectionRef` is what
  // makes it terminate: every channel is marked before its detection runs, so
  // channels that yield no language (short sample, or `franc` returns "und")
  // are not rescanned for the rest of the session. Without it they stay in the
  // "no language" set and are refetched every few seconds, forever.
  useEffect(() => {
    const detectMissingLanguages = async () => {
      const attempted = attemptedLanguageDetectionRef.current
      const channelsWithoutLanguage = selectChannelsForLanguageDetection(
        channels,
        attempted,
      )
      if (channelsWithoutLanguage.length === 0) return

      let detectedAny = false
      for (const channel of channelsWithoutLanguage) {
        attempted.add(channel.name)
        try {
          // Bounded read: detection samples at most
          // LANGUAGE_DETECTION_SAMPLE_SIZE posts, and the feed returns them
          // newest-first, so there is nothing to gain by fetching more.
          //
          // Straight to the feed rather than through `repository` (A1c): the
          // repository wrapper's only extra behaviour here was falling back to
          // the IndexedDB mirror, and ADR-009 makes the server authoritative.
          // A failed sample is already caught below and simply retried later.
          const recentPosts = await api.getPostsFeed({
            channelNames: [channel.name],
            startDate: Date.now() - LANGUAGE_DETECTION_LOOKBACK_MS,
            endDate: Date.now(),
            sort: "time",
            limit: LANGUAGE_DETECTION_SAMPLE_SIZE,
          })
          if (recentPosts && recentPosts.length > 0) {
            recentPosts.sort((a, b) => b.id - a.id)
            const lang = detectLanguageFromPosts(recentPosts)
            if (lang) {
              const updatedChannel = { ...channel, language: lang }
              await upsertChannel(updatedChannel)
              detectedAny = true
              logger.debug(
                `[Background] Detected language for @${channel.name}: ${lang}`,
              )
            }
          }
        } catch (e) {
          console.error(
            `[Background] Failed to detect language for @${channel.name}`,
            e,
          )
        }
      }
      // Only refresh when something actually changed — an unconditional
      // reload re-arms this effect for no reason.
      if (detectedAny) await loadChannels()
    }

    const timer = setTimeout(detectMissingLanguages, 5000)
    return () => clearTimeout(timer)
  }, [loadChannels, channels])

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

  const handleScrapeAll = async () => {
    if (channels.length === 0) {
      toast.error("Please add at least one channel first")
      return
    }

    const channelsToScrape = filterChannelsForOperation(channels, "sync_all")
    if (channelsToScrape.length === 0) {
      toast.info("No channels eligible for Sync All")
      return
    }

    try {
      await scrapeChannelsInParallel(
        channelsToScrape,
        "Manual (Sync All)",
        "sync_all",
      )
      if (activeTab !== "channels") setActiveTab("posts")
    } catch (err: unknown) {
      console.error(err)
      toast.error(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred during scraping",
      )
    }
  }

  const handleScrapeSelected = async () => {
    if (selectedChannels.size === 0) {
      toast.error("Please select at least one channel first")
      return
    }

    const selected = channels.filter((c) => selectedChannels.has(c.name))
    const channelsToScrape = filterChannelsForOperation(selected, "bulk")
    if (channelsToScrape.length === 0) {
      toast.info("No selected channels eligible for bulk sync")
      return
    }

    try {
      await scrapeChannelsInParallel(
        channelsToScrape,
        "Manual (Sync Selected)",
        "bulk",
      )
      if (activeTab !== "channels") setActiveTab("posts")
    } catch (err: unknown) {
      console.error(err)
      toast.error(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred during scraping",
      )
    }
  }

  const handleRecheckRestricted = async () => {
    const restricted = channels.filter((c) => c.isUnavailableOnWebView)
    if (restricted.length === 0) {
      toast.info("No restricted channels to recheck")
      return
    }

    try {
      await scrapeChannelsInParallel(
        restricted,
        "Manual (Recheck Restricted)",
        "recheck_restricted",
      )
      if (activeTab !== "channels") setActiveTab("posts")
    } catch (err: unknown) {
      console.error(err)
      toast.error(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred during recheck",
      )
    }
  }

  const addNewChannel = async (
    channelName: string,
    discoveredVia?: { channelName: string; postId: number; timestamp: number },
  ) => {
    if (isOffline) {
      toast.warning("Server offline — cannot add channels while offline.")
      return
    }
    const cleanName =
      channelName.trim().replace(/^@/, "").split("/").pop() || ""
    if (!cleanName) return

    if (
      channels.some((c) => c.name.toLowerCase() === cleanName.toLowerCase())
    ) {
      toast.info(`Channel @${cleanName} is already in your workspace`)
      return
    }

    let displayName = cleanName
    let photoUrl
    let isUnavailableOnWebView = false
    const effectiveStartTime = getEffectiveGlobalStartTime()

    const activeProxies = buildActiveProxies({
      proxyEnabled,
      defaultProxyUrls,
      torEnabled,
      torMode,
      torProxyUrls,
    })

    try {
      const data = (await api.channelInfo({
        channelName: cleanName,
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
      })) as Record<string, unknown>

      if (data.displayName) displayName = String(data.displayName)
      if (data.photoUrl) photoUrl = String(data.photoUrl)
      if (data.isUnavailableOnWebView) isUnavailableOnWebView = true
      if (data.error && !data.isUnavailableOnWebView) {
        toast.error(String(data.error))
      }
    } catch (err: unknown) {
      console.error("Failed to fetch initial channel info:", err)
      const parsed = parseApiError(err)
      if (parsed.isUnavailableOnWebView) {
        isUnavailableOnWebView = true
      } else if (parsed.message) {
        toast.error(parsed.message)
      }
    }

    const newChannel: Channel = {
      id: cleanName,
      name: cleanName,
      displayName,
      photoUrl,
      startTime: effectiveStartTime,
      lastUpdated: Date.now(),
      followedAt: Date.now(),
      tags: [],
      isFrozen: isUnavailableOnWebView,
      isUnavailableOnWebView,
      autoFollowForwarded: false,
      regularSyncEnabled: !isUnavailableOnWebView,
      dynamicSyncEnabled: false,
      discoveredVia,
    }

    await upsertChannel(newChannel)
    await loadChannels()

    if (isUnavailableOnWebView) {
      toast.warning(unavailableChannelToastMessage(cleanName), {
        duration: 8000,
      })
    } else {
      toast.success(`Added @${cleanName} to workspace`)
      addToSyncQueue(newChannel, "Manual (Added from Forward)", () => {})
    }
  }

  return (
    <ScraperContext.Provider
      value={{
        postSearch,
        setPostSearch,
        semanticSearchQuery,
        setSemanticSearchQuery,
        semanticSearchRespectsTimeRange,
        setSemanticSearchRespectsTimeRange,
        semanticSearchRespectsChannels,
        setSemanticSearchRespectsChannels,
        relatedPostSearch,
        setRelatedPostSearch,
        scrapingChannels,
        setScrapingChannels,
        handleFilterPosts,
        getScopedPosts,
        getPromptPostsInput,
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
