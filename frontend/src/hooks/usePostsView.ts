import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { api } from "@/api"
import type { PostFeedQuery } from "@/api/data"
import { useData } from "@/contexts/DataContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import { buildPostsInScopeCounts } from "@/lib/channels/sort-channels-for-grid"
import type { Post } from "@/types"
import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"
import { useDebouncedValue } from "./useDebouncedValue"

/** One page of the infinite Posts feed. */
export const FEED_PAGE_SIZE = 20

function useSelectedChannelNames(): string[] {
  const { channels, selectedChannels } = useData()
  return useMemo(
    () =>
      channels
        .filter((channel) => selectedChannels.has(channel.name))
        .map((channel) => channel.name),
    [channels, selectedChannels],
  )
}

/**
 * Per-channel in-scope post counts, on demand. Server-side (SQL `GROUP BY`)
 * when no semantic search is active and a selection exists; otherwise counted
 * from the client scoped posts (semantic/related results aren't reproducible
 * server-side). Replaces the render-time reads of the eager `filteredPosts`
 * array in App/SummaryConfig/ChannelCard/ChannelGrid.
 */
export function useScopedPostCounts(): Record<string, number> {
  const { selectedChannels } = useData()
  const { startDate, endDate } = useUI()
  const {
    postSearch,
    forwardedFilter,
    mediaFilter,
    maxPostsPerChannel,
    semanticSearchQuery,
    getScopedPosts,
  } = useScraper()
  const debouncedPostSearch = useDebouncedValue(postSearch, 300)
  const selectedChannelNames = useSelectedChannelNames()

  const serverEligible =
    !semanticSearchQuery.trim() && selectedChannels.size > 0

  const params = {
    channelNames: selectedChannelNames,
    startDate,
    endDate,
    keyword: debouncedPostSearch,
    forwarded: forwardedFilter,
    media: mediaFilter,
    maxPerChannel: maxPostsPerChannel,
  }
  const query = useQuery({
    queryKey: queryKeys.postsCounts(params),
    queryFn: () => api.getPostsCounts(params),
    enabled: serverEligible,
    staleTime: SUMMARIZER_STALE_TIME,
    placeholderData: (previous) => previous,
  })

  // Client fallback for the semantic/related path.
  const [clientCounts, setClientCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    if (serverEligible) return
    let cancelled = false
    getScopedPosts().then((posts) => {
      if (!cancelled) setClientCounts(buildPostsInScopeCounts(posts))
    })
    return () => {
      cancelled = true
    }
  }, [serverEligible, getScopedPosts])

  return serverEligible ? (query.data ?? {}) : clientCounts
}

export interface PostsFeed {
  posts: Post[]
  isInitialLoading: boolean
  hasMore: boolean
  loadMore: () => void
  isLoadingMore: boolean
}

/**
 * The Posts-tab feed. For the normal path it pages the server feed
 * (`GET /data/posts` with filters + cap + sort) via an infinite query — only
 * `FEED_PAGE_SIZE` rows per page, more on scroll. When a semantic/related
 * search is active it keeps the client RAG path (≤50, no pagination), per the
 * agreed design. The query key encodes the scope + filters, so any change
 * refetches the first page; a completed sync invalidates it (see ScraperContext).
 */
export function usePostsFeed(): PostsFeed {
  const { startDate, endDate } = useUI()
  const {
    postSearch,
    forwardedFilter,
    mediaFilter,
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
    semanticSearchQuery,
    setSemanticSearchQuery,
    relatedPostSearch,
    setRelatedPostSearch,
    getScopedPosts,
  } = useScraper()
  const { embeddingsEnabled } = useSettings()
  const debouncedPostSearch = useDebouncedValue(postSearch, 300)
  const debouncedSemantic = useDebouncedValue(semanticSearchQuery, 300)
  const selectedChannelNames = useSelectedChannelNames()

  const semanticActive =
    embeddingsEnabled && (!!relatedPostSearch || !!debouncedSemantic.trim())

  const feedParams: PostFeedQuery = {
    channelNames: selectedChannelNames,
    startDate,
    endDate,
    keyword: debouncedPostSearch,
    forwarded: forwardedFilter,
    media: mediaFilter,
    maxPerChannel: maxPostsPerChannel,
    maxPerChannelMode: maxPostsPerChannelMode,
    sort: postSortOrder,
    seed: 0,
  }

  const infinite = useInfiniteQuery({
    queryKey: queryKeys.postsFeed(feedParams),
    queryFn: ({ pageParam }) =>
      api.getPostsFeed({
        ...feedParams,
        limit: FEED_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < FEED_PAGE_SIZE
        ? undefined
        : allPages.length * FEED_PAGE_SIZE,
    enabled: !semanticActive,
    staleTime: SUMMARIZER_STALE_TIME,
  })

  // Client RAG path for semantic/related search.
  const [clientPosts, setClientPosts] = useState<Post[]>([])
  const [clientLoading, setClientLoading] = useState(false)
  useEffect(() => {
    if (!semanticActive) {
      setClientPosts([])
      return
    }
    let cancelled = false
    setClientLoading(true)
    getScopedPosts()
      .then((posts) => {
        if (!cancelled) setClientPosts(posts)
      })
      .catch((error) => {
        if (cancelled) return
        // Preserve the old handleFilterPosts fallback: on a failed
        // semantic/related search, toast and clear the search that triggered it.
        const message = error instanceof Error ? error.message : "Search failed"
        toast.error(`${message}. Falling back to normal view.`)
        if (relatedPostSearch) setRelatedPostSearch(null)
        else setSemanticSearchQuery("")
      })
      .finally(() => {
        if (!cancelled) setClientLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    semanticActive,
    getScopedPosts,
    relatedPostSearch,
    setRelatedPostSearch,
    setSemanticSearchQuery,
  ])

  if (semanticActive) {
    return {
      posts: clientPosts,
      isInitialLoading: clientLoading && clientPosts.length === 0,
      hasMore: false,
      loadMore: () => {},
      isLoadingMore: false,
    }
  }

  return {
    posts: infinite.data?.pages.flat() ?? [],
    isInitialLoading: infinite.isLoading,
    hasMore: infinite.hasNextPage,
    loadMore: () => {
      if (infinite.hasNextPage && !infinite.isFetchingNextPage) {
        infinite.fetchNextPage()
      }
    },
    isLoadingMore: infinite.isFetchingNextPage,
  }
}
