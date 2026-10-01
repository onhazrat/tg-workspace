import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { api } from "@/api"
import { type PostFeedQuery, postScopeBody, shownPostsBody } from "@/api/data"
import {
  dataPostsCounts,
  dataPostsFacets,
  dataPostsViewEstimate,
  type PostFacetsRequest,
  type PostFacetsResponse,
  type PostFilteredRequest,
  type ViewEstimateResponse,
} from "@/client"
import { useData } from "@/contexts/DataContext"
import { useScope } from "@/contexts/ScopeContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { errorText } from "@/lib/artifacts/artifact-run"
import { buildPostsInScopeCounts } from "@/lib/channels/sort-channels-for-grid"
import {
  type ChannelSpotlight,
  spotlightView,
} from "@/lib/posts/channel-spotlight"
import { printPostFilter } from "@/lib/posts/post-filter"
import { EXPORT_LIMIT } from "@/lib/posts/selected-export"
import type { Post } from "@/types"
import {
  queryKeys,
  SUMMARIZER_STALE_TIME,
  VIEW_ESTIMATE_STALE_TIME,
} from "./queryKeys"
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
 * Per-channel counts of the Posts an Action covers: the selected Posts in the
 * window (PTR-05). The Scope's, so the Post filter is not in it: a Summary
 * covers the Post selection whatever the tab shows (ADR-026). Server-side
 * even during a meaning search, which changes what the tab shows and not the
 * selection. Replaces the render-time reads of the eager `filteredPosts`
 * array in App/SummaryAction/ChannelCard/ChannelGrid.
 */
export function useScopedPostCounts(): Record<string, number> {
  const { selectedChannels } = useData()
  const { startDate, endDate, windowKey } = useScope()
  const { postSelection, selectionEdit } = useScraper()
  const channelNames = useSelectedChannelNames()
  const enabled = selectedChannels.size > 0
  const query = useQuery({
    // An edit moves the revision, which stands for the selection here
    // rather than a key as large as 5,000 Picks.
    queryKey: queryKeys.postsCounts({
      channelNames,
      window: windowKey,
      selection: selectionEdit.revision,
    }),
    queryFn: () =>
      dataPostsCounts({
        body: postScopeBody({
          channelNames,
          startDate,
          endDate,
          selection: postSelection,
        }) as PostFilteredRequest,
      }),
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
  const { startDate, endDate, windowKey } = useScope()
  const {
    postFilter: accountFilter,
    postSearch,
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
    viewMeasure,
    semanticSearchQuery,
    getScopedPosts,
    postSelection,
    selectionEdit,
  } = useScraper()
  const debouncedPostSearch = useDebouncedValue(postSearch, 300)
  const selectedChannelNames = useSelectedChannelNames()

  const serverEligible =
    !semanticSearchQuery.trim() && selectedChannels.size > 0

  const view = spotlightView(spotlight, {
    channelNames: selectedChannelNames,
    keyword: debouncedPostSearch,
    filter: accountFilter,
    maxPerChannel: maxPostsPerChannel,
    groupByChannel: false,
  })
  const filter = view.filter
  // Which Posts the cap keeps, as the feed asks: the Venn counts those.
  const filters = {
    channelNames: view.channelNames,
    keyword: view.keyword,
    maxPerChannel: view.maxPerChannel,
    maxPerChannelMode: maxPostsPerChannelMode,
    sort: postSortOrder,
    viewMeasure,
    seed: 0,
  }
  // The filter by its text, which is stable where the tree's ids are not.
  const keyed = { ...filters, filter: printPostFilter(filter) }
  const query = useQuery({
    // Keyed on the window rather than the minute it currently resolves to —
    // see `usePostsFeed`, which pays for this and says why. An edit moves the
    // revision, which stands for the selection.
    queryKey: queryKeys.postsCounts({
      ...keyed,
      window: windowKey,
      selection: selectionEdit.revision,
    }),
    queryFn: () =>
      dataPostsCounts({
        body: shownPostsBody({
          ...filters,
          filter,
          startDate,
          endDate,
          selection: postSelection,
        }) as PostFilteredRequest,
      }),
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
 * Filters aside, so it is keyed on the Channels, the window and the
 * selection alone. Server-side, and only while `enabled` and the feed is the
 * server's: a meaning search's ranked Posts are not a scope the server can
 * count.
 */
export function usePostFacets(
  enabled: boolean,
  spotlight: ChannelSpotlight | null,
): PostFacetsResponse | undefined {
  const { selectedChannels } = useData()
  const { startDate, endDate, windowKey } = useScope()
  const { semanticSearchQuery, postSelection, selectionEdit } = useScraper()
  const selected = useSelectedChannelNames()
  // A spotlight's window is its Channel's, so "N of M" reads against it.
  const channelNames = spotlight ? [spotlight.channel] : selected
  const query = useQuery({
    queryKey: queryKeys.postsFacets({
      channelNames,
      window: windowKey,
      selection: selectionEdit.revision,
    }),
    queryFn: () =>
      dataPostsFacets({
        body: postScopeBody({
          channelNames,
          startDate,
          endDate,
          selection: postSelection,
        }) as PostFacetsRequest,
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
  const { startDate, endDate, windowKey } = useScope()
  const {
    postSearch,
    postFilter,
    viewMeasure,
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
    groupByChannel,
    semanticSearchQuery,
    setSemanticSearchQuery,
    relatedPostSearch,
    setRelatedPostSearch,
    getScopedPosts,
    postSelection,
    selectionEdit,
  } = useScraper()
  const queryClient = useQueryClient()
  const { embeddingsEnabled } = useSettings()
  const debouncedPostSearch = useDebouncedValue(postSearch, 300)
  const debouncedSemantic = useDebouncedValue(semanticSearchQuery, 300)
  const selectedChannelNames = useSelectedChannelNames()

  const semanticActive = isSemanticFeed(
    embeddingsEnabled,
    relatedPostSearch,
    debouncedSemantic,
  )

  const { filter, ...view } = spotlightView(spotlight, {
    channelNames: selectedChannelNames,
    keyword: debouncedPostSearch,
    filter: postFilter,
    maxPerChannel: maxPostsPerChannel,
    groupByChannel,
  })
  const filters = {
    ...view,
    viewMeasure,
    maxPerChannelMode: maxPostsPerChannelMode,
    sort: postSortOrder,
    seed: 0,
    selectedFirst,
  }
  // The selection rides the request and not the key: an edit refreshes the
  // rows in place below, and a new key would drop the Account back to the
  // top of the feed on every tick (PTR-05).
  const feedParams: PostFeedQuery = {
    ...filters,
    filter,
    startDate,
    endDate,
    selection: postSelection,
  }
  // The filter by its text, which is stable where the tree's ids are not.
  const keyed = { ...filters, filter: printPostFilter(filter) }

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
    queryKey: queryKeys.postsFeed({ ...keyed, window: windowKey }),
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
      posts: await api.getPostsFeed({
        ...feedParams,
        selectedFirst: false,
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
