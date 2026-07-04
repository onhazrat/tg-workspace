import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { api, type SyncJobStatus, subscribeSyncJobEvents } from "@/api"
import { parseApiError, unavailableChannelToastMessage } from "@/lib/api-errors"
import { env } from "@/lib/env"
import { useApiStatus } from "../hooks/useApiStatus"
import { useDebouncedValue } from "../hooks/useDebouncedValue"
import { useSyncQueue } from "../hooks/useSyncQueue"
import { detectLanguageFromPosts } from "../lib/language"
import {
  applyPostViewPipeline,
  buildFilteredPostsFromRaw,
  type MaxPostsPerChannelMode,
  type PostSortOrder,
  type PostViewOptions,
} from "../lib/posts/post-view"
import {
  getChannelStats,
  getPostsByDateRange,
  upsertChannel,
} from "../lib/repository"
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
  isFiltering: boolean
  scrapingChannels: Set<string>
  setScrapingChannels: React.Dispatch<React.SetStateAction<Set<string>>>
  filteredPosts: Post[]
  isInitialPostLoadPending: boolean
  visiblePosts: number
  setVisiblePosts: React.Dispatch<React.SetStateAction<number>>
  handleFilterPosts: () => Promise<void>
  setFilteredPosts: React.Dispatch<React.SetStateAction<Post[]>>
  handleScrapeChannel: (
    channel: Channel,
    refresh?: boolean,
    source?: string,
    options?: { ignoreFrozen?: boolean },
  ) => Promise<void>
  handleScrapeAll: () => Promise<void>
  handleScrapeSelected: () => Promise<void>
  scrapeChannelsInParallel: (
    channelsToScrape: Channel[],
    source: string,
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
  forwardedFilter: "all" | "forwarded" | "original" | "unfollowed_forwarded"
  setForwardedFilter: React.Dispatch<
    React.SetStateAction<
      "all" | "forwarded" | "original" | "unfollowed_forwarded"
    >
  >
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

  const [postSearch, setPostSearch] = useState("")
  const [semanticSearchQuery, setSemanticSearchQuery] = useState("")
  const [semanticSearchRespectsTimeRange, setSemanticSearchRespectsTimeRange] =
    useState(false)
  const [semanticSearchRespectsChannels, setSemanticSearchRespectsChannels] =
    useState(false)
  const [relatedPostSearch, setRelatedPostSearch] = useState<Post | null>(null)
  const [isFiltering, setIsFiltering] = useState(false)
  const [scrapingChannels, setScrapingChannels] = useState<Set<string>>(
    new Set(),
  )
  const [filteredPosts, setFilteredPosts] = useState<Post[]>([])
  const [isInitialPostLoadPending, setIsInitialPostLoadPending] =
    useState<boolean>(true)
  const [visiblePosts, setVisiblePosts] = useState(20)
  const [autoSyncPauseUntil, setAutoSyncPauseUntil] = useState<number | null>(
    null,
  )
  const [consecutiveFailures, setConsecutiveFailures] = useState<number>(0)
  const [forwardedFilter, setForwardedFilter] = useState<
    "all" | "forwarded" | "original" | "unfollowed_forwarded"
  >("all")
  const [maxPostsPerChannel, setMaxPostsPerChannel] = useState<number>(() => {
    const saved = localStorage.getItem("postFilter_maxPerChannel")
    const parsed = saved ? Number.parseInt(saved, 10) : 0
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  })
  const [maxPostsPerChannelMode, setMaxPostsPerChannelMode] =
    useState<MaxPostsPerChannelMode>(() => {
      const saved = localStorage.getItem("postFilter_maxPerChannelMode")
      return saved === "random" ? "random" : "latest"
    })
  const [postSortOrder, setPostSortOrder] = useState<PostSortOrder>(() => {
    const saved = localStorage.getItem("postFilter_sortOrder")
    return saved === "channel_time" ? "channel_time" : "time"
  })
  const scrapingLocksRef = React.useRef<Set<string>>(new Set())
  const activeJobRef = useRef<string | null>(null)

  const debouncedPostSearch = useDebouncedValue(postSearch, 300)
  const debouncedSemanticSearchQuery = useDebouncedValue(
    semanticSearchQuery,
    300,
  )

  const postViewOptions: PostViewOptions = {
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
  }

  useEffect(() => {
    localStorage.setItem(
      "postFilter_maxPerChannel",
      maxPostsPerChannel.toString(),
    )
  }, [maxPostsPerChannel])

  useEffect(() => {
    localStorage.setItem("postFilter_maxPerChannelMode", maxPostsPerChannelMode)
  }, [maxPostsPerChannelMode])

  useEffect(() => {
    localStorage.setItem("postFilter_sortOrder", postSortOrder)
  }, [postSortOrder])

  // Background language detection for existing channels
  useEffect(() => {
    const detectMissingLanguages = async () => {
      const channelsWithoutLanguage = channels.filter(
        (c) => !c.language && !c.isUnavailableOnWebView,
      )
      if (channelsWithoutLanguage.length === 0) return

      for (const channel of channelsWithoutLanguage) {
        try {
          const recentPosts = await getPostsByDateRange(
            [channel.name],
            0,
            Date.now(),
          )
          if (recentPosts && recentPosts.length > 0) {
            recentPosts.sort((a, b) => b.id - a.id)
            const lang = detectLanguageFromPosts(recentPosts)
            if (lang) {
              const updatedChannel = { ...channel, language: lang }
              await upsertChannel(updatedChannel)
              console.log(
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
      await loadChannels()
    }

    const timer = setTimeout(detectMissingLanguages, 5000)
    return () => clearTimeout(timer)
  }, [loadChannels, channels.filter, channels])

  const handleFilterPosts = useCallback(
    async (
      searchText = debouncedPostSearch,
      semanticQuery = debouncedSemanticSearchQuery,
    ) => {
      setIsFiltering(true)
      try {
        if (embeddingsEnabled && relatedPostSearch) {
          try {
            const results = await searchSimilarPosts(relatedPostSearch.text, 50)
            let otherPosts = results.filter(
              (p) =>
                p.id !== relatedPostSearch.id ||
                p.channelName !== relatedPostSearch.channelName,
            )

            if (forwardedFilter === "forwarded") {
              otherPosts = otherPosts.filter((p) => !!p.forwardedFrom)
            } else if (forwardedFilter === "original") {
              otherPosts = otherPosts.filter((p) => !p.forwardedFrom)
            } else if (forwardedFilter === "unfollowed_forwarded") {
              otherPosts = otherPosts.filter(
                (p) =>
                  p.forwardedFrom &&
                  !channels.some(
                    (c) =>
                      c.name.toLowerCase() === p.forwardedFrom?.toLowerCase(),
                  ),
              )
            }

            setFilteredPosts(
              applyPostViewPipeline(otherPosts, postViewOptions, {
                startDate,
                endDate,
              }),
            )
            setVisiblePosts(20)
          } catch (error) {
            console.error("Related post search failed:", error)
            const message =
              error instanceof Error
                ? error.message
                : "Related post search failed"
            toast.error(`${message}. Falling back to normal view.`)
            setRelatedPostSearch(null)
          }
          return
        }

        if (embeddingsEnabled && semanticQuery.trim()) {
          try {
            let results = await searchSimilarPosts(semanticQuery, 50, {
              startDate: semanticSearchRespectsTimeRange
                ? startDate
                : undefined,
              endDate: semanticSearchRespectsTimeRange ? endDate : undefined,
              channels:
                semanticSearchRespectsChannels && selectedChannels.size > 0
                  ? Array.from(selectedChannels)
                  : undefined,
            })

            if (forwardedFilter === "forwarded") {
              results = results.filter((p) => !!p.forwardedFrom)
            } else if (forwardedFilter === "original") {
              results = results.filter((p) => !p.forwardedFrom)
            } else if (forwardedFilter === "unfollowed_forwarded") {
              results = results.filter(
                (p) =>
                  p.forwardedFrom &&
                  !channels.some(
                    (c) =>
                      c.name.toLowerCase() === p.forwardedFrom?.toLowerCase(),
                  ),
              )
            }

            setFilteredPosts(
              applyPostViewPipeline(results, postViewOptions, {
                startDate,
                endDate,
              }),
            )
            setVisiblePosts(20)
          } catch (error) {
            console.error("Semantic search failed:", error)
            const message =
              error instanceof Error ? error.message : "Semantic search failed"
            toast.error(`${message}. Falling back to normal view.`)
            setSemanticSearchQuery("")
          }
          return
        }

        const selectedNames = Array.from(selectedChannels)
        const rawPosts = await getPostsByDateRange(
          selectedNames,
          startDate,
          endDate,
        )
        const posts = buildFilteredPostsFromRaw(rawPosts, {
          searchText,
          forwardedFilter,
          channels,
          view: postViewOptions,
          startDate,
          endDate,
        })

        setFilteredPosts(posts)
        setVisiblePosts(20)
      } finally {
        setIsFiltering(false)
        setIsInitialPostLoadPending(false)
      }
    },
    [
      startDate,
      endDate,
      selectedChannels,
      debouncedPostSearch,
      debouncedSemanticSearchQuery,
      relatedPostSearch,
      embeddingsEnabled,
      semanticSearchRespectsTimeRange,
      semanticSearchRespectsChannels,
      searchSimilarPosts,
      forwardedFilter,
      channels,
      maxPostsPerChannel,
      maxPostsPerChannelMode,
      postSortOrder,
    ],
  )

  const applySyncJobStatus = useCallback(
    (status: SyncJobStatus) => {
      const active = status.channels
        .filter((ch) => ch.status === "running" || ch.status === "pending")
        .map((ch) => ch.channelName)
      setScrapingChannels(new Set(active))

      const hasRateLimit = status.channels.some(
        (ch) => ch.error && /rate limit/i.test(ch.error),
      )
      setIsRateLimited(hasRateLimit)
    },
    [setIsRateLimited],
  )

  const pollSyncJobFallback = useCallback(
    async (jobId: string) => {
      const deadline = Date.now() + env.syncJobTimeoutMs
      while (Date.now() < deadline) {
        const status = await api.getSyncJobStatus(jobId)
        applySyncJobStatus(status)
        if (["completed", "failed", "cancelled"].includes(status.status)) {
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
          if (["completed", "failed", "cancelled"].includes(status.status)) {
            return status
          }
        }
        const finalStatus = await api.getSyncJobStatus(jobId)
        applySyncJobStatus(finalStatus)
        return finalStatus
      } catch (err) {
        if (abortController.signal.aborted) {
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
    ) => {
      if (isOffline) {
        toast.warning(
          "Server offline — sync disabled. Browsing cached data only.",
        )
        return
      }
      if (channelIds.length === 0) return

      console.log(
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
          ;({ jobId } = await api.startSyncJob({ channelIds, source }))
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (message.includes("No channels to sync")) {
            toast.error(
              "No channels available to sync. Try re-adding the channel or run the user_id backfill script.",
            )
          }
          throw err
        }
        activeJobRef.current = jobId
        const result = await waitSyncJob(jobId)

        const failures = result.channels.filter((ch) => ch.status === "failed")
        const successes = result.channels.filter(
          (ch) => ch.status === "success",
        )

        if (successes.length > 0) {
          setConsecutiveFailures(0)
          setAutoSyncPauseUntil(null)
          for (const ch of successes) {
            const s = await getChannelStats(ch.channelId, ch.channelName)
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
            if (next >= Math.max(3, channels.length)) {
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
          await loadSyncLogs()
          await handleFilterPosts()
        }

        if (failures.length > 0 && successes.length === 0) {
          throw new Error(failures[0].error || "Sync failed")
        }
      } finally {
        activeJobRef.current = null
        setScrapingChannels((prev) => {
          const next = new Set(prev)
          channelNames.forEach((n) => next.delete(n))
          return next
        })
      }
    },
    [
      isOffline,
      channels.length,
      waitSyncJob,
      loadChannels,
      loadSyncLogs,
      handleFilterPosts,
      setChannelStats,
    ],
  )

  const handleScrapeChannel = useCallback(
    async (
      channel: Channel,
      refresh = true,
      source = "Manual",
      options?: { ignoreFrozen?: boolean },
    ) => {
      if (channel.isFrozen && !options?.ignoreFrozen) {
        console.log(
          `[Scraper] Skipping sync for @${channel.name} because it is frozen.`,
        )
        return
      }
      if (scrapingLocksRef.current.has(channel.name)) {
        console.log(
          `[Scraper] Sync already in progress for @${channel.name}. Skipping duplicate request.`,
        )
        return
      }
      scrapingLocksRef.current.add(channel.name)
      try {
        await runServerSync([channel.id], [channel.name], source, refresh)
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

  useEffect(() => {
    handleFilterPosts()
  }, [handleFilterPosts])

  const scrapeChannelsInParallel = async (
    channelsToScrape: Channel[],
    source: string,
  ) => {
    if (isOffline) {
      toast.warning(
        "Server offline — sync disabled. Browsing cached data only.",
      )
      return
    }
    const active = channelsToScrape.filter((c) => !c.isFrozen)
    if (active.length === 0) return

    console.log(
      `[SyncQueue] Starting server job for ${active.length} channels from ${source}`,
    )
    await runServerSync(
      active.map((c) => c.id),
      active.map((c) => c.name),
      source,
      true,
    )
  }

  const handleScrapeAll = async () => {
    if (channels.length === 0) {
      toast.error("Please add at least one channel first")
      return
    }

    const channelsToScrape = channels.filter((c) => !c.isFrozen)
    if (channelsToScrape.length === 0) {
      toast.info("All channels are frozen")
      return
    }

    try {
      await scrapeChannelsInParallel(channelsToScrape, "Manual (Sync All)")
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

    const channelsToScrape = channels.filter(
      (c) => selectedChannels.has(c.name) && !c.isFrozen,
    )
    if (channelsToScrape.length === 0) {
      toast.info("Selected channels are frozen")
      return
    }

    try {
      await scrapeChannelsInParallel(channelsToScrape, "Manual (Sync Selected)")
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
        isFiltering,
        scrapingChannels,
        setScrapingChannels,
        filteredPosts,
        isInitialPostLoadPending,
        visiblePosts,
        setVisiblePosts,
        handleFilterPosts,
        setFilteredPosts,
        handleScrapeChannel,
        handleScrapeAll,
        handleScrapeSelected,
        scrapeChannelsInParallel,
        syncQueue,
        isProcessingQueue,
        addToSyncQueue,
        autoSyncPauseUntil,
        setAutoSyncPauseUntil,
        consecutiveFailures,
        setConsecutiveFailures,
        addNewChannel,
        forwardedFilter,
        setForwardedFilter,
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
