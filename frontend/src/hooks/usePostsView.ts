import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"

import { api } from "@/api"
import {
  dataPostsViewEstimate,
  type PostFacetsResponse,
  type PostValueHistogramResponse,
  type ViewEstimateResponse,
} from "@/client"
import {
  usePostsViewEdits,
  usePostsViewState,
} from "@/contexts/PostsViewContext"
import { useRAG } from "@/contexts/RAGContext"
import { useScope } from "@/contexts/ScopeContext"
import type { WindowHistogramQuery } from "@/lib/analysis-window"
import { errorText } from "@/lib/artifacts/artifact-run"
import { buildPostsInScopeCounts } from "@/lib/channels/sort-channels-for-grid"
import {
  type ChannelSpotlight,
  spotlightView,
} from "@/lib/posts/channel-spotlight"
import type { PostNumber } from "@/lib/posts/post-filter"
import {
  feedQuery,
  fetchSelectedShown,
  isRanked,
  NO_RANKING,
  PICK_POOL_LIMIT,
  type PostsView,
  postsQuery,
  rankingQuery,
  servedBy,
} from "@/lib/posts/posts-view"
import type { RankingApi } from "@/lib/posts/scoped-posts"
import type { Post } from "@/types"
import { queryKeys, VIEW_ESTIMATE_STALE_TIME } from "./queryKeys"

/**
 * Refresh the Posts views when a Live window has moved (AW-04).
 *
 * `ScopeContext` owns the timer — one for the whole application, so the "ago"
 * labels everywhere move together. This is the other half: it turns a tick into
 * an *invalidation* of the post views. Invalidation rather than a new key is
 * the whole point, because the pages already loaded stay loaded and the Account
 * keeps their scroll.
 *
 * Call it from the surface that shows Posts, handing it that surface's refresh,
 * `invalidatePostsReads`, which covers the feed, the counts and the Discover
 * candidates, all three of which a moved window changes. The refresh arrives
 * as an argument so this can be tested against a spy and one provider.
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

/**
 * The Posts view every Posts read is built from (ADR-036), as the Posts view
 * module builds it, with `spotlight` applied. `postsRead` turns it into a
 * read's key and body.
 */
export function usePostsView(spotlight: ChannelSpotlight | null): PostsView {
  const { view } = usePostsViewState()
  // One identity per view, so a callback built on it (the command registry's
  // in-scope counts) does not change on every render.
  return useMemo(() => spotlightView(spotlight, view), [spotlight, view])
}

/**
 * Per-channel counts of the Posts an Action covers: the selected Posts in the
 * window (PTR-05). The Scope's, so the Post filter is not in it: a Summary
 * covers the Post selection whatever the tab shows (ADR-026). Server-side
 * even during a Ranking, which changes what the tab shows and not the
 * selection.
 */
export function useScopedPostCounts(): Record<string, number> {
  const options = postsQuery(usePostsView(null), { kind: "scopeCounts" })
  const query = useQuery(options)
  return (options.enabled && query.data?.selected) || NO_COUNTS
}

const NO_COUNTS: Record<string, number> = {}
const NO_SHOWN_COUNTS = {
  counts: NO_COUNTS,
  tooNewToJudge: 0,
  selectedShown: 0,
}
const NO_POSTS: Post[] = []

/**
 * What the Posts tab shows under the Post filter: per-channel counts, how
 * many Posts an Estimated views bound hid for being too new to judge (PFB-03,
 * PTR-03), and how many of the shown Posts the Post selection selects, which
 * is the Adjust selection Venn's middle region (PTR-06). One request for all
 * three, which follows a spotlight. While ranked it counts the ranked Posts
 * the Post filter kept, for a find-related as for a meaning search, and
 * reports none too new.
 */
export function useShownPostCounts(spotlight: ChannelSpotlight | null): {
  counts: Record<string, number>
  tooNewToJudge: number
  selectedShown: number
} {
  const view = usePostsView(spotlight)
  const options = postsQuery(view, { kind: "shownCounts" })
  const query = useQuery(options)
  const ranking = useRanking()
  const rankedCounts = useMemo(
    () => buildPostsInScopeCounts(ranking.data ?? NO_POSTS),
    [ranking.data],
  )

  if (servedBy(view, { kind: "shownCounts" }) === "ranking")
    return { counts: rankedCounts, tooNewToJudge: 0, selectedShown: 0 }
  if (!options.enabled) return NO_SHOWN_COUNTS
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
 * Filters aside, and the Ranking aside: they describe the window, so they
 * stay during either kind. A spotlight's window is its Channel's, so "N of M"
 * reads against it. Fetched only while `enabled`.
 */
export function usePostFacets(
  enabled: boolean,
  spotlight: ChannelSpotlight | null,
): PostFacetsResponse | undefined {
  const options = postsQuery(usePostsView(spotlight), { kind: "facets" })
  return useQuery({ ...options, enabled: enabled && options.enabled }).data
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
  return useQuery(
    postsQuery(usePostsView(spotlight), {
      kind: "valueHistogram",
      measure,
      zoom,
    }),
  ).data
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
  return useQuery(
    postsQuery(usePostsView(spotlight), { kind: "windowHistogram", query }),
  ).data
}

/**
 * The curve and settings an Estimated View count reads through, cached for an
 * hour: the curve is refitted daily and the settings change by hand. Shares
 * its cache entry with `useRankingApi`'s `getViewEstimate`.
 */
export function useViewEstimate(): ViewEstimateResponse | undefined {
  return useQuery(VIEW_ESTIMATE_QUERY).data
}

const VIEW_ESTIMATE_QUERY = {
  queryKey: queryKeys.viewEstimate,
  queryFn: () => dataPostsViewEstimate(),
  staleTime: VIEW_ESTIMATE_STALE_TIME,
}

/**
 * What the Ranking's fetch calls, one identity while the vector search and
 * the query client hold still.
 */
function useRankingApi(): RankingApi {
  const { searchSimilarPosts } = useRAG()
  const queryClient = useQueryClient()
  return useMemo(
    () => ({
      searchSimilarPosts,
      lookupPosts: api.lookupPosts,
      getViewEstimate: () => queryClient.fetchQuery(VIEW_ESTIMATE_QUERY),
    }),
    [searchSimilarPosts, queryClient],
  )
}

/**
 * The Ranking's results, from its one cached query (`rankingQuery`): the
 * feed, the shown counts and the pick-post list read the same entry, so a
 * meaning search runs once per query and comes back free while fresh. No
 * spotlight, so all three share the key. Off while not ranked, or while
 * `enabled` is false.
 */
export function useRanking(enabled = true) {
  const options = rankingQuery(usePostsView(null), useRankingApi())
  return useQuery({ ...options, enabled: enabled && options.enabled })
}

/**
 * The command palette's Find related Posts list, fetched while `open`: the
 * first 100 Posts the tab shows. While ranked, the Ranking's cached Posts;
 * otherwise the feed's own request.
 */
export function usePickPool(open: boolean): Post[] {
  const view = usePostsView(null)
  const ranked = servedBy(view, { kind: "pickPool" }) === "ranking"
  const ranking = useRanking(open)
  const options = postsQuery(view, { kind: "pickPool" })
  const server = useQuery({ ...options, enabled: open && options.enabled })
  return useMemo(
    () =>
      ranked
        ? (ranking.data ?? NO_POSTS).slice(0, PICK_POOL_LIMIT)
        : (server.data ?? NO_POSTS),
    [ranked, ranking.data, server.data],
  )
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
 * The Posts-tab feed: two queries behind `isRanked`, one of them off. Not
 * ranked, it pages the server feed `FEED_PAGE_SIZE` Posts at a time; ranked,
 * it shows the Ranking's results (at most 50, no paging). A completed sync
 * invalidates the server feed (see SyncContext) and never the Ranking.
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
  const { selectionEdit } = usePostsViewState()
  const { setRanking } = usePostsViewEdits()
  const queryClient = useQueryClient()
  const view = usePostsView(spotlight)
  const ranked = isRanked(view)
  const rankingApi = useRankingApi()

  const infinite = useInfiniteQuery(feedQuery(view, selectedFirst))
  const ranking = useRanking()

  // A selection edit, after the render that carries it, so a refetch reads
  // the new selection. Picks reach only their own Posts, so their rows are
  // patched where they are; anything else asks the server again (PTR-05).
  const seenEdit = useRef(selectionEdit.revision)
  useEffect(() => {
    if (seenEdit.current === selectionEdit.revision) return
    seenEdit.current = selectionEdit.revision
    // Under Selected first a Pick moves its Post between the two parts, so
    // the pages are refetched or the next offset would skip and repeat one.
    if (!selectionEdit.picks || (selectedFirst && !ranked)) {
      queryClient.invalidateQueries({ queryKey: queryKeys.postsFeeds })
      // ponytail: runs the vector search again with the lookup, though only
      // the lookup's flags change; split the two into cached steps if this
      // edit while ranked shows up in the search costs.
      queryClient.invalidateQueries({ queryKey: queryKeys.postsRankings })
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
      { queryKey: queryKeys.postsFeeds },
      (data) => data && { ...data, pages: data.pages.map(patch) },
    )
    queryClient.setQueriesData<Post[]>(
      { queryKey: queryKeys.postsRankings },
      (data) => data && patch(data),
    )
  }, [selectionEdit, queryClient, selectedFirst, ranked])

  // On a failed meaning or related search, toast and end the search.
  useEffect(() => {
    if (!ranking.error) return
    toast.error(
      `${errorText(ranking.error, "Search failed")}. Falling back to normal view.`,
    )
    setRanking({ ranking: NO_RANKING })
  }, [ranking.error, setRanking])

  const selectedShown = async () => {
    const posts = await fetchSelectedShown(queryClient, view, rankingApi)
    return { posts, total: ranked ? posts.length : selectedShownTotal }
  }

  if (ranked) {
    const rankedPosts = ranking.data ?? NO_POSTS
    return {
      // The ranked Posts are here already, so the switch sorts them here,
      // stably, by the flag the server set (PTR-06).
      posts: selectedFirst
        ? [...rankedPosts].sort(
            (a, b) => Number(!!b.selected) - Number(!!a.selected),
          )
        : rankedPosts,
      isInitialLoading: ranking.isLoading,
      hasMore: false,
      loadMore: () => {},
      isLoadingMore: false,
      fetchSelectedShown: selectedShown,
    }
  }

  return {
    fetchSelectedShown: selectedShown,
    posts: infinite.data?.pages.flat() ?? NO_POSTS,
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
