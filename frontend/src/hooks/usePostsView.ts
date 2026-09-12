import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { api } from "@/api"
import type { PostFeedQuery } from "@/api/data"
import { useData } from "@/contexts/DataContext"
import { useScope } from "@/contexts/ScopeContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { buildPostsInScopeCounts } from "@/lib/channels/sort-channels-for-grid"
import type { Post } from "@/types"
import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"
import { useDebouncedValue } from "./useDebouncedValue"

/** One page of the infinite Posts feed. */
export const FEED_PAGE_SIZE = 20

/**
 * Refresh the Posts views when a Live window has moved (AW-04).
 *
 * `ScopeContext` owns the timer — one for the whole application, so the "ago"
 * labels everywhere move together. This is the other half: it turns a tick into
 * an *invalidation* of the post views. Invalidation rather than a new key is
 * the whole point, because the pages already loaded stay loaded and the Account
 * keeps their scroll.
 *
 * Call it from the surface that shows Posts, handing it that surface's refresh —
 * `ScraperContext.invalidatePostViews`, which covers the feed, the counts and
 * the Discover candidates, all three of which a moved window changes. The
 * refresh arrives as an argument rather than being read from the context here
 * so this can be tested against a spy and one provider.
 *
 * ponytail: an invalidation refetches every loaded page of the infinite feed,
 * so a deeply scrolled tab costs one round trip per page per minute. Bound it
 * with `maxPages` if that shows up in the edge log — it is a paging-semantics
 * change, not a local one, so it is not made on spec.
 */
export function useLiveWindowRefresh(refresh: () => void): void {
  const { liveTick } = useScope()
  // A tick is a *change*, so the value this mounted at is not one. Without
  // this the first render would refetch a feed that has just been fetched, on
  // every visit to the tab.
  const seen = useRef(liveTick)

  useEffect(() => {
    if (seen.current === liveTick) return
    seen.current = liveTick
    refresh()
  }, [liveTick, refresh])
}

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
  const { startDate, endDate, windowKey } = useScope()
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

  const filters = {
    channelNames: selectedChannelNames,
    keyword: debouncedPostSearch,
    forwarded: forwardedFilter,
    media: mediaFilter,
    maxPerChannel: maxPostsPerChannel,
  }
  const params = { ...filters, startDate, endDate }
  const query = useQuery({
    // Keyed on the window rather than the minute it currently resolves to —
    // see `usePostsFeed`, which pays for this and says why.
    queryKey: queryKeys.postsCounts({ ...filters, window: windowKey }),
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
 * (`POST /data/posts` with filters + cap + sort) via an infinite query — only
 * `FEED_PAGE_SIZE` rows per page, more on scroll. When a semantic/related
 * search is active it keeps the client RAG path (≤50, no pagination), per the
 * agreed design. The query key encodes the scope + filters, so any change
 * refetches the first page; a completed sync invalidates it (see ScraperContext).
 */
export function usePostsFeed(): PostsFeed {
  const { startDate, endDate, windowKey } = useScope()
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

  const filters = {
    channelNames: selectedChannelNames,
    keyword: debouncedPostSearch,
    forwarded: forwardedFilter,
    media: mediaFilter,
    maxPerChannel: maxPostsPerChannel,
    maxPerChannelMode: maxPostsPerChannelMode,
    sort: postSortOrder,
    seed: 0,
  }
  const feedParams: PostFeedQuery = { ...filters, startDate, endDate }

  const infinite = useInfiniteQuery({
    /*
     * Keyed on the *window*, not the boundaries it currently resolves to.
     *
     * A Live window resolves to a new pair every minute (AW-04). A key built
     * from that pair would be a different key every minute: the infinite query
     * would remount at page one, whatever the Account had scrolled past would
     * be gone, and a fresh cache entry would be minted per minute per filter
     * combination. The window's *identity* — 24 hours ending at the current
     * minute — does not change on a tick, so the key does not either, and
     * `liveTick` refreshes the pages that are already loaded.
     *
     * `feedParams` still carries fresh boundaries: the query function is read
     * from the latest render, so a refetch asks for the minute it happens in.
     */
    queryKey: queryKeys.postsFeed({ ...filters, window: windowKey }),
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
