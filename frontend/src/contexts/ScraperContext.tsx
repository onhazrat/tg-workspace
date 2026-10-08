import { useQueryClient } from "@tanstack/react-query"
import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import {
  api,
  type BulkFollowChannelInput,
  type FollowJobStatus,
  streamFollowJobEvents,
} from "@/api"
import type { PromptScope } from "@/api/data"
import { dataPostsViewEstimate, type ScopeSubmission } from "@/client"
import { addForwardedChannel } from "@/lib/channels/add-channel"
import {
  type ManualSyncMode,
  manualSyncErrorText,
  planManualSync,
} from "@/lib/channels/manual-sync"
import { logger } from "@/lib/logger"
import { queryKeys, VIEW_ESTIMATE_STALE_TIME } from "../hooks/queryKeys"
import { useApiStatus } from "../hooks/useApiStatus"
import { type FollowOptions, useFollowJob } from "../hooks/useFollowJob"
import { usePostFilterParam } from "../hooks/usePostFilterParam"
import { usePostFilters } from "../hooks/usePostFilters"
import { usePromptPosts } from "../hooks/usePromptPosts"
import { useSyncJob } from "../hooks/useSyncJob"
import { useSyncQueue } from "../hooks/useSyncQueue"
import { channelAllows, disabledReason } from "../lib/channels/sync-permissions"
import type { PostFilter } from "../lib/posts/post-filter"
import {
  appendSteps,
  loadSelection,
  type PostSelection,
  removeChip,
  type SelectionChip,
  type SelectionPick,
  type SelectionStep,
  saveSelection,
} from "../lib/posts/post-selection"
import type {
  MaxPostsPerChannelMode,
  PostSortOrder,
  PostViewOptions,
  ViewMeasure,
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
  getPromptPostsInput: () => Promise<{ scope: PromptScope }>
  /**
   * The current Scope as an Action submits it, for the server to freeze
   * (AW-05). See `usePromptPosts`.
   */
  getScopeSubmission: (channels: string[]) => ScopeSubmission
  handleScrapeChannel: (
    channel: Channel,
    refresh?: boolean,
    source?: string,
  ) => Promise<void>
  handleScrapeAll: () => Promise<void>
  /** The running Sync All job, or null. */
  syncAllJobId: string | null
  /** Cancel the running Sync All job, queued Channels included. */
  stopSyncAll: () => Promise<void>
  /** Syncs `names`, or the whole selection when none are given. */
  handleScrapeSelected: (names?: Set<string>) => Promise<void>
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
    options?: FollowOptions,
  ) => Promise<FollowJobStatus | null>
  /** What the Posts tab shows, from `?postFilter=` (PTR-03). */
  postFilter: PostFilter
  setPostFilter: (next: PostFilter) => void
  /**
   * What an Action covers (PTR-05): an ordered list of Selection rules and
   * Picks, for the browser session, per Account.
   */
  postSelection: PostSelection
  /**
   * The last edit: a number that moves on every one, and the Picks it
   * appended when it appended nothing else. The feed patches those rows in
   * place rather than refetching; any other edit refetches it.
   */
  selectionEdit: SelectionEdit
  /** Append steps; false, with a toast saying why, when a bound refuses. */
  appendSelection: (steps: SelectionStep[]) => boolean
  removeSelectionChip: (chip: Pick<SelectionChip, "start" | "end">) => void
  replaceSelection: (steps: PostSelection) => void
  maxPostsPerChannel: number
  setMaxPostsPerChannel: React.Dispatch<React.SetStateAction<number>>
  maxPostsPerChannelMode: MaxPostsPerChannelMode
  setMaxPostsPerChannelMode: React.Dispatch<
    React.SetStateAction<MaxPostsPerChannelMode>
  >
  postSortOrder: PostSortOrder
  setPostSortOrder: React.Dispatch<React.SetStateAction<PostSortOrder>>
  groupByChannel: boolean
  setGroupByChannel: React.Dispatch<React.SetStateAction<boolean>>
  viewMeasure: ViewMeasure
  setViewMeasure: React.Dispatch<React.SetStateAction<ViewMeasure>>
  postViewOptions: PostViewOptions
}

export type SelectionEdit = {
  revision: number
  picks: SelectionPick[] | null
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
    queryClient.invalidateQueries({ queryKey: ["postsFacets"] })
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
    maxPostsPerChannel,
    setMaxPostsPerChannel,
    maxPostsPerChannelMode,
    setMaxPostsPerChannelMode,
    postSortOrder,
    setPostSortOrder,
    groupByChannel,
    setGroupByChannel,
    viewMeasure,
    setViewMeasure,
    postViewOptions,
    debouncedPostSearch,
    debouncedSemanticSearchQuery,
  } = usePostFilters()
  const { postFilter, setPostFilter } = usePostFilterParam()

  // The Post selection (PTR-05). The ref is what an edit reads, so two edits
  // in one tick each build on the other rather than on the last render.
  const [postSelection, setPostSelectionState] =
    useState<PostSelection>(loadSelection)
  const selectionRef = useRef(postSelection)
  const [selectionEdit, setSelectionEdit] = useState<SelectionEdit>({
    revision: 0,
    picks: null,
  })
  const commitSelection = useCallback(
    (next: PostSelection, picks: SelectionPick[] | null) => {
      selectionRef.current = next
      setPostSelectionState(next)
      saveSelection(next)
      setSelectionEdit((edit) => ({ revision: edit.revision + 1, picks }))
    },
    [],
  )
  const appendSelection = useCallback(
    (steps: SelectionStep[]) => {
      const next = appendSteps(selectionRef.current, steps)
      if (typeof next === "string") {
        toast.error(next)
        return false
      }
      const picks = steps.filter((s): s is SelectionPick => s.kind === "pick")
      commitSelection(next, picks.length === steps.length ? picks : null)
      return true
    },
    [commitSelection],
  )
  const removeSelectionChip = useCallback(
    (chip: Pick<SelectionChip, "start" | "end">) =>
      commitSelection(removeChip(selectionRef.current, chip), null),
    [commitSelection],
  )
  const replaceSelection = useCallback(
    (steps: PostSelection) => commitSelection(steps, null),
    [commitSelection],
  )

  const getViewEstimate = useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.viewEstimate,
        queryFn: () => dataPostsViewEstimate(),
        staleTime: VIEW_ESTIMATE_STALE_TIME,
      }),
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
    syncAllJobId,
    stopSyncAll,
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
      selectedChannels,
      startDate,
      endDate,
      windowKey,
      embeddingsEnabled,
      debouncedPostSearch,
      debouncedSemanticSearchQuery,
      relatedPostSearch,
      postFilter,
      postSelection,
      postViewOptions,
      semanticSearchRespectsChannels,
      searchSimilarPosts,
      getPostsFeed: api.getPostsFeed,
      lookupPosts: api.lookupPosts,
      getViewEstimate,
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
      await scrapeChannelsInParallel(plan.channels, plan.source, plan.syncMode)
      if (activeTab !== "channels") setActiveTab("posts")
    } catch (err: unknown) {
      console.error(err)
      toast.error(manualSyncErrorText(err, mode))
    }
  }

  const handleScrapeAll = () => runManualSync("sync_all")
  const handleScrapeSelected = (names?: Set<string>) =>
    runManualSync("bulk", names)
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
        syncAllJobId,
        stopSyncAll,
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
        postFilter,
        setPostFilter,
        postSelection,
        selectionEdit,
        appendSelection,
        removeSelectionChip,
        replaceSelection,
        maxPostsPerChannel,
        setMaxPostsPerChannel,
        maxPostsPerChannelMode,
        setMaxPostsPerChannelMode,
        postSortOrder,
        setPostSortOrder,
        groupByChannel,
        setGroupByChannel,
        viewMeasure,
        setViewMeasure,
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
