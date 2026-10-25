import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { api } from "@/api"
import {
  dataPostsCounts,
  dataPostsFacets,
  dataPostsValueHistogram,
  dataPostsViewEstimate,
  dataPostsWindowHistogram,
  type PostFacetsRequest,
  type PostFacetsResponse,
  type PostFilteredRequest,
  type PostValueHistogramRequest,
  type PostValueHistogramResponse,
  type PostWindowHistogramRequest,
  type ViewEstimateResponse,
} from "@/client"
import { useData } from "@/contexts/DataContext"
import { useScope } from "@/contexts/ScopeContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import type { WindowHistogramQuery } from "@/lib/analysis-window"
import { errorText } from "@/lib/artifacts/artifact-run"
import { buildPostsInScopeCounts } from "@/lib/channels/sort-channels-for-grid"
import {
  type ChannelSpotlight,
  spotlightView,
} from "@/lib/posts/channel-spotlight"
import type { PostNumber } from "@/lib/posts/post-filter"
import { type PostsView, postsRead } from "@/lib/posts/posts-view"
import { EXPORT_LIMIT } from "@/lib/posts/selected-export"
import type { Post } from "@/types"
import {
  queryKeys,
  SUMMARIZER_STALE_TIME,
  VIEW_ESTIMATE_STALE_TIME,
} from "./queryKeys"

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
 * The Posts view every Posts read is built from (ADR-036), gathered from the
 * contexts with `spotlight` applied. `postsRead` turns it into a read's key
 * and body.
 */
export function usePostsView(spotlight: ChannelSpotlight | null): PostsView {
  const { startDate, endDate, windowKey } = useScope()
  const {
    debouncedPostSearch,
    postFilter,
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
    groupByChannel,
    viewMeasure,
    postSelection,
    selectionEdit,
  } = useScraper()
  const selected = useSelectedChannelNames()
  const selectionRevision = selectionEdit.revision
  // One identity per view, so a callback built on it (the command registry's
  // in-scope counts) does not change on every render.
  return useMemo(
    () =>
      spotlightView(spotlight, {
        scopeChannelNames: selected,
        channelNames: selected,
        keyword: debouncedPostSearch,
        filter: postFilter,
        maxPerChannel: maxPostsPerChannel,
        maxPerChannelMode: maxPostsPerChannelMode,
        sort: postSortOrder,
        groupByChannel,
        viewMeasure,
        startDate,
        endDate,
        windowKey,
        selection: postSelection,
        selectionRevision,
      }),
    [
      spotlight,
      selected,
      debouncedPostSearch,
      postFilter,
      maxPostsPerChannel,
      maxPostsPerChannelMode,
      postSortOrder,
      groupByChannel,
      viewMeasure,
      startDate,
      endDate,
      windowKey,
      postSelection,
      selectionRevision,
    ],
  )
}

/**
 * Per-channel counts of the Posts an Action covers: the selected Posts in the
 * window (PTR-05). The Scope's, so the Post filter is not in it: a Summary
 * covers the Post selection whatever the tab shows (ADR-026). Server-side
 * even during a meaning search, which changes what the tab shows and not the
 * selection. Replaces the render-time reads of the eager `filteredPosts`
 * array in App/SummaryAction/ChannelCard/ChannelGrid.
 */
export function useScopedPostCounts(): Record<string, number> {
  const { selectedChannels } = useData()
  const { queryKey, body } = postsRead(usePostsView(null), {
    kind: "scopeCounts",
  })
  const enabled = selectedChannels.size > 0
  const query = useQuery({
    queryKey,
    queryFn: () => dataPostsCounts({ body: body as PostFilteredRequest }),
    enabled,
    staleTime: SUMMARIZER_STALE_TIME,
    placeholderData: (previous) => previous,
  })
  return (enabled && query.data?.selected) || NO_COUNTS
}

const NO_COUNTS: Record<string, number> = {}

/**
 * What the Posts tab shows under the Post filter: per-channel counts, how
 * many Posts an Estimated views bound hid for being too new to judge (PFB-03,
 * PTR-03), and how many of the shown Posts the Post selection selects, which
 * is the Adjust selection Venn's middle region (PTR-06). One request for all
 * three. A meaning search has no server count and reports none too new. It
 * follows a spotlight.
 */
export function useShownPostCounts(spotlight: ChannelSpotlight | null): {
  counts: Record<string, number>
  tooNewToJudge: number
  selectedShown: number
} {
  const { selectedChannels } = useData()
  const { semanticSearchQuery, getScopedPosts } = useScraper()
  const serverEligible =
    !semanticSearchQuery.trim() && selectedChannels.size > 0
  // Which Posts the cap keeps, as the feed asks: the Venn counts those.
  const { queryKey, body } = postsRead(usePostsView(spotlight), {
    kind: "shownCounts",
  })
  const query = useQuery({
    queryKey,
    queryFn: () => dataPostsCounts({ body: body as PostFilteredRequest }),
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

  if (!serverEligible)
    return { counts: clientCounts, tooNewToJudge: 0, selectedShown: 0 }
  return {
    counts: query.data?.counts ?? {},
    tooNewToJudge: query.data?.tooNewToJudge ?? 0,
    selectedShown: sum(query.data?.selectedShown),
  }
}

const sum = (counts: Record<string, number> | undefined) =>
  Object.values(counts ?? {}).reduce((total, n) => total + n, 0)

/**
 * How many Posts in the window have each Type, media kind and Language, and
 * how many there are, for the dropdowns and the filter row (PTR-03), with how
 * many of each value the Post selection selects for the ticks (PTR-06).
 * Filters aside; a spotlight's window is its Channel's, so "N of M" reads
 * against it. Server-side, and only while `enabled` and the feed is the
 * server's: a meaning search's ranked Posts are not a scope the server can
 * count.
 */
export function usePostFacets(
  enabled: boolean,
  spotlight: ChannelSpotlight | null,
): PostFacetsResponse | undefined {
  const { selectedChannels } = useData()
  const { semanticSearchQuery } = useScraper()
  const { queryKey, body } = postsRead(usePostsView(spotlight), {
    kind: "facets",
  })
  const query = useQuery({
    queryKey,
    queryFn: () => dataPostsFacets({ body: body as PostFacetsRequest }),
    enabled:
      enabled && !semanticSearchQuery.trim() && selectedChannels.size > 0,
    staleTime: SUMMARIZER_STALE_TIME,
    placeholderData: (previous) => previous,
  })
  return query.data
}

/**
 * One number's bars over the window and the selected Channels, or the
 * spotlit one, for a number filter's editor (PTI-01). Filters aside, so the
 * bars hold still while the Account changes another Condition. Channel posts
 * in filtered window is the exception: its count is what the filter and the
 * keyword keep (PTI-02).
 */
export function usePostValueHistogram(
  measure: PostNumber,
  spotlight: ChannelSpotlight | null,
  /** Bin only this range, on the scale first drawn (TB-04). */
  zoom?: { lo: number; hi: number; log: boolean } | null,
): PostValueHistogramResponse | undefined {
  const view = usePostsView(spotlight)
  const { queryKey, body } = postsRead(view, {
    kind: "valueHistogram",
    measure,
    zoom,
  })
  return useQuery({
    queryKey,
    queryFn: () =>
      dataPostsValueHistogram({ body: body as PostValueHistogramRequest }),
    enabled: view.channelNames.length > 0,
    staleTime: SUMMARIZER_STALE_TIME,
    placeholderData: (previous) => previous,
  }).data
}

/**
 * The Posts in each slice of the Analysis window chart's extent (PTI-03).
 * Filtered, what the Post filter, keyword and spotlight keep, the cap aside;
 * unfiltered, every Post of the selected Channels.
 */
export function usePostWindowHistogram(
  query: WindowHistogramQuery,
  spotlight: ChannelSpotlight | null,
): number[] | undefined {
  const view = usePostsView(spotlight)
  const { queryKey, body } = postsRead(view, { kind: "windowHistogram", query })
  const channelNames = query.unfiltered
    ? view.scopeChannelNames
    : view.channelNames
  return useQuery({
    queryKey,
    queryFn: async () =>
      (
        await dataPostsWindowHistogram({
          body: body as PostWindowHistogramRequest,
        })
      ).counts,
    enabled: channelNames.length > 0,
    staleTime: SUMMARIZER_STALE_TIME,
    placeholderData: (previous) => previous,
  }).data
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
  /**
   * The selected Posts the filter shows, in the feed's order, at most
   * `EXPORT_LIMIT`, and how many there are: what Copy links and Export
   * Markdown take (PTR-06).
   */
  fetchSelectedShown: () => Promise<{ posts: Post[]; total: number }>
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
export function usePostsFeed(
  spotlight: ChannelSpotlight | null,
  {
    selectedFirst = false,
    selectedShownTotal = 0,
  }: {
    selectedFirst?: boolean
    /** The counts read's selected Posts the filter shows, past any limit. */
    selectedShownTotal?: number
  } = {},
): PostsFeed {
  const {
    debouncedSemanticSearchQuery,
    setSemanticSearchQuery,
    relatedPostSearch,
    setRelatedPostSearch,
    getScopedPosts,
    selectionEdit,
  } = useScraper()
  const queryClient = useQueryClient()
  const { embeddingsEnabled } = useSettings()
  const view = usePostsView(spotlight)

  const semanticActive = isSemanticFeed(
    embeddingsEnabled,
    relatedPostSearch,
    debouncedSemanticSearchQuery,
  )

  // The selection rides the body and not the key: an edit refreshes the
  // rows in place below (PTR-05). See `postsRead` for the window.
  const feed = postsRead(view, { kind: "feed", selectedFirst })
  const infinite = useInfiniteQuery({
    queryKey: feed.queryKey,
    queryFn: ({ pageParam }) =>
      api.getPostsFeedBody({
        ...feed.body,
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
  // Moves when an edit other than Picks needs the ranked Posts flagged again.
  const [ruleEdits, setRuleEdits] = useState(0)

  // A selection edit, after the render that carries it, so a refetch reads
  // the new selection. Picks reach only their own Posts, so their rows are
  // patched where they are; anything else asks the server again (PTR-05).
  const seenEdit = useRef(selectionEdit.revision)
  useEffect(() => {
    if (seenEdit.current === selectionEdit.revision) return
    seenEdit.current = selectionEdit.revision
    // Under Selected first a Pick moves its Post between the two parts, so
    // the pages are refetched or the next offset would skip and repeat one.
    if (!selectionEdit.picks || (selectedFirst && !semanticActive)) {
      queryClient.invalidateQueries({ queryKey: ["postsFeed"] })
      setRuleEdits((n) => n + 1)
      return
    }
    const flags = new Map(
      selectionEdit.picks.map((p) => [
        `${p.channelName}:${p.postId}`,
        p.select,
      ]),
    )
    const patch = (posts: Post[]) =>
      posts.map((p) => {
        const selected = flags.get(`${p.channelName}:${p.id}`)
        return selected === undefined ? p : { ...p, selected }
      })
    queryClient.setQueriesData<InfiniteData<Post[]>>(
      { queryKey: ["postsFeed"] },
      (data) => data && { ...data, pages: data.pages.map(patch) },
    )
    setClientPosts(patch)
  }, [selectionEdit, queryClient, selectedFirst, semanticActive])

  useEffect(() => {
    // Read so a rule edit re-flags the ranked Posts; see `ruleEdits`.
    void ruleEdits
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
    ruleEdits,
  ])

  if (semanticActive) {
    return {
      // The ranked Posts are here already, so the switch sorts them here,
      // stably, by the flag the server set (PTR-06).
      posts: selectedFirst
        ? [...clientPosts].sort(
            (a, b) => Number(!!b.selected) - Number(!!a.selected),
          )
        : clientPosts,
      isInitialLoading: clientLoading && clientPosts.length === 0,
      hasMore: false,
      loadMore: () => {},
      isLoadingMore: false,
      fetchSelectedShown: async () => {
        const shown = clientPosts.filter((p) => p.selected)
        return { posts: shown, total: shown.length }
      },
    }
  }

  return {
    fetchSelectedShown: async () => ({
      posts: await api.getPostsFeedBody({
        ...postsRead(view, { kind: "feed" }).body,
        onlySelected: true,
        limit: EXPORT_LIMIT,
        offset: 0,
      }),
      total: selectedShownTotal,
    }),
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
