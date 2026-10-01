import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { api } from "@/api"
import { type PostFeedQuery, postScopeBody } from "@/api/data"
import {
  dataPostsCounts,
  dataPostsFacets,
  dataPostsViewEstimate,
  type PostFacetsResponse,
  type PostScopeRequest,
  type ViewEstimateResponse,
} from "@/client"
import { useData } from "@/contexts/DataContext"
import { useScope } from "@/contexts/ScopeContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { errorText } from "@/lib/artifacts/artifact-run"
import { buildPostsInScopeCounts } from "@/lib/channels/sort-channels-for-grid"
import type { Post } from "@/types"
import {
  queryKeys,
  SUMMARIZER_STALE_TIME,
  VIEW_ESTIMATE_STALE_TIME,
} from "./queryKeys"
import { useDebouncedValue } from "./useDebouncedValue"
import { POST_SEARCH_DEBOUNCE_MS } from "./usePostFilters"

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
 * array in App/SummaryAction/ChannelCard/ChannelGrid.
 */
export function useScopedPostCounts(): Record<string, number> {
  return useScopeCounts().counts
}

/**
 * How many Posts an Estimated views threshold hid for being too new to judge,
 * for the footer (PFB-03). The same query as `useScopedPostCounts`, so the two
 * cost one request. A meaning search has no server count and reports none.
 */
export function useTooNewToJudge(): number {
  return useScopeCounts().tooNewToJudge
}

function useScopeCounts(): {
  counts: Record<string, number>
  tooNewToJudge: number
} {
  const { selectedChannels } = useData()
  const { startDate, endDate, windowKey } = useScope()
  const {
    postSearch,
    forwardedFilter,
    mediaFilter,
    languageFilter,
    viewMeasure,
    viewsFilter,
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
    languages: languageFilter,
    viewMeasure,
    views: viewsFilter,
    maxPerChannel: maxPostsPerChannel,
  }
  const params = { ...filters, startDate, endDate }
  const query = useQuery({
    // Keyed on the window rather than the minute it currently resolves to —
    // see `usePostsFeed`, which pays for this and says why.
    queryKey: queryKeys.postsCounts({ ...filters, window: windowKey }),
    queryFn: () =>
      dataPostsCounts({ body: postScopeBody(params) as PostScopeRequest }),
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

  if (!serverEligible) return { counts: clientCounts, tooNewToJudge: 0 }
  return {
    counts: query.data?.counts ?? {},
    tooNewToJudge: query.data?.tooNewToJudge ?? 0,
  }
}

/**
 * How many Posts each Language and each media kind would leave, for the
 * pills' checklists (PFB-02). Server-side, and only while `enabled` (a pill
 * is open) and the feed is the server's: a meaning search's ranked Posts are
 * not a scope the server can count, so its pills show no numbers.
 */
export function usePostFacets(
  enabled: boolean,
): PostFacetsResponse | undefined {
  const { selectedChannels } = useData()
  const { startDate, endDate, windowKey } = useScope()
  const {
    postSearch,
    forwardedFilter,
    mediaFilter,
    languageFilter,
    viewMeasure,
    viewsFilter,
    maxPostsPerChannel,
    semanticSearchQuery,
  } = useScraper()
  const debouncedPostSearch = useDebouncedValue(
    postSearch,
    POST_SEARCH_DEBOUNCE_MS,
  )
  const selectedChannelNames = useSelectedChannelNames()
  const filters = {
    channelNames: selectedChannelNames,
    keyword: debouncedPostSearch,
    forwarded: forwardedFilter,
    media: mediaFilter,
    languages: languageFilter,
    viewMeasure,
    views: viewsFilter,
    maxPerChannel: maxPostsPerChannel,
  }
  const query = useQuery({
    queryKey: queryKeys.postsFacets({ ...filters, window: windowKey }),
    queryFn: () =>
      dataPostsFacets({
        body: postScopeBody({
          ...filters,
          startDate,
          endDate,
        }) as PostScopeRequest,
      }),
    enabled:
      enabled && !semanticSearchQuery.trim() && selectedChannels.size > 0,
    staleTime: SUMMARIZER_STALE_TIME,
    placeholderData: (previous) => previous,
  })
  return query.data
}

/**
 * The curve and settings an Estimated View count reads through, cached for an
 * hour: the curve is refitted daily and the settings change by hand. Shares
 * its cache entry with `ScraperContext.getViewEstimate`.
 */
export function useViewEstimate(): ViewEstimateResponse | undefined {
  return useQuery({
    queryKey: queryKeys.viewEstimate,
    queryFn: () => dataPostsViewEstimate(),
    staleTime: VIEW_ESTIMATE_STALE_TIME,
  }).data
}

export interface PostsFeed {
  posts: Post[]
  isInitialLoading: boolean
  hasMore: boolean
  loadMore: () => void
  isLoadingMore: boolean
}

/**
 * Whether the feed takes the client RAG path instead of the server feed: only
 * with embeddings on, and only while a related-post or semantic search is set.
 */
export function isSemanticFeed(
  embeddingsEnabled: boolean,
  relatedPostSearch: Post | null,
  semanticQuery: string,
): boolean {
  return embeddingsEnabled && (!!relatedPostSearch || !!semanticQuery.trim())
}

/**
 * The Posts-tab feed. For the normal path it pages the server feed
 * (`POST /data/posts` with filters + cap + sort) via an infinite query — only
 * `FEED_PAGE_SIZE` rows per page, more on scroll. When a semantic/related
 * search is active it keeps the client RAG path (≤50, no pagination), per the
 * agreed design. The query key encodes the scope + filters, so any change
 * refetches the first page; a completed sync invalidates it (see ScraperContext).
 */
/**
 * PROTOTYPE (post-card): up to `VIEWS_SAMPLE` newest Posts of the Scope, with
 * no views bound, for the views histogram. Fetched only while `enabled`.
 * ponytail: a sample of whole Posts; the real one is a server histogram
 * (`width_bucket` over the Scope) so it costs one small response.
 */
export const VIEWS_SAMPLE = 2000

export function useViewsSample(enabled: boolean): Post[] | undefined {
  const { startDate, endDate, windowKey } = useScope()
  const {
    postSearch,
    forwardedFilter,
    mediaFilter,
    languageFilter,
    semanticSearchQuery,
  } = useScraper()
  const debouncedPostSearch = useDebouncedValue(postSearch, 300)
  const channelNames = useSelectedChannelNames()
  const filters = {
    channelNames,
    keyword: debouncedPostSearch,
    forwarded: forwardedFilter,
    media: mediaFilter,
    languages: languageFilter,
  }
  return useQuery({
    queryKey: ["proto-views-sample", { ...filters, window: windowKey }],
    queryFn: () =>
      api.getPostsFeed({
        ...filters,
        startDate,
        endDate,
        sort: "newest",
        limit: VIEWS_SAMPLE,
        offset: 0,
      }),
    enabled: enabled && !semanticSearchQuery.trim() && channelNames.length > 0,
    staleTime: SUMMARIZER_STALE_TIME,
    placeholderData: (previous) => previous,
  }).data
}

/** PROTOTYPE (post-card): a temporary "only this Channel" view of the feed. */
export type ChannelFocus = { channel: string; keepFilters: boolean }

export function usePostsFeed(focus: ChannelFocus | null = null): PostsFeed {
  const { startDate, endDate, windowKey } = useScope()
  const {
    postSearch,
    forwardedFilter,
    mediaFilter,
    languageFilter,
    viewMeasure,
    viewsFilter,
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
    groupByChannel,
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
    !focus &&
    isSemanticFeed(embeddingsEnabled, relatedPostSearch, debouncedSemantic)

  const baseFilters = {
    channelNames: selectedChannelNames,
    keyword: debouncedPostSearch,
    forwarded: forwardedFilter,
    media: mediaFilter,
    languages: languageFilter,
    viewMeasure,
    views: viewsFilter,
    maxPerChannel: maxPostsPerChannel,
    maxPerChannelMode: maxPostsPerChannelMode,
    sort: postSortOrder,
    groupByChannel,
    seed: 0,
  }
  // PROTOTYPE (post-card): focus drops the cap and grouping, and unless asked
  // keeps nothing but the window and the order.
  const filters = !focus
    ? baseFilters
    : focus.keepFilters
      ? {
          ...baseFilters,
          channelNames: [focus.channel],
          maxPerChannel: 0,
          groupByChannel: false,
        }
      : {
          ...baseFilters,
          channelNames: [focus.channel],
          keyword: "",
          forwarded: "all" as const,
          media: [],
          languages: [],
          views: null,
          maxPerChannel: 0,
          groupByChannel: false,
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
        toast.error(
          `${errorText(error, "Search failed")}. Falling back to normal view.`,
        )
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
