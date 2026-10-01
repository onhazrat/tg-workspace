import type { PostFeedQuery } from "@/api/data"
import type { ViewEstimate } from "@/lib/posts/estimated-views"
import type { Post } from "@/types"
import { isEmptyPostFilter, type PostFilter } from "./post-filter"
import {
  buildFilteredPostsFromRaw,
  type PostViewOptions,
  readsEstimatedViews,
} from "./post-view"

/**
 * Ceiling on the non-semantic branch's fetch (A1c).
 *
 * The branch used to be unbounded: it paged a channel's whole history into the
 * browser and filtered there. It is now one `POST /data/posts` call, and
 * bounding it is only sound because the server **sorts before it limits** — so
 * `limit: N` returns the first N of the same ordering the client pipeline
 * produced, not an arbitrary N.
 *
 * The one caller that reaches this branch (`useEntityFlow`'s pick-post pool)
 * takes `.slice(0, 100)` immediately, so 200 is generous. A caller that needs
 * more than this should page the feed (`usePostsFeed`) rather than raise the
 * number.
 */
export const SCOPED_POSTS_LIMIT = 200

/**
 * Everything `computeScopedPosts` needs to reproduce today's
 * `ScraperContext.handleFilterPosts` post-selection, with no React/state
 * dependency. The three branches (related-post search, semantic search, the
 * normal date-range path) mirror `handleFilterPosts` exactly so that a lazy,
 * on-demand call returns the identical post set the eager `filteredPosts`
 * array would have held for the same inputs.
 */
export interface ScopedPostsDeps {
  /** Debounced free-text keyword filter (normal path only). */
  searchText: string
  /** Debounced semantic-search query; when non-empty it takes the RAG path. */
  semanticQuery: string
  /** When set (and embeddings on), the related-post RAG branch is used. */
  relatedPostSearch: Post | null
  embeddingsEnabled: boolean
  selectedChannels: string[]
  startDate: number
  endDate: number
  /**
   * What the Posts tab shows (PTR-03). Empty for an Action's own read, which
   * the Post filter never narrows (ADR-026).
   */
  postFilter: PostFilter
  postViewOptions: PostViewOptions
  semanticSearchRespectsChannels: boolean
  searchSimilarPosts: (
    query: string,
    limit: number,
    options: { channels?: string[]; startDate: number; endDate: number },
  ) => Promise<Post[]>
  /**
   * The server feed. Injected rather than imported so the branch stays
   * testable without a network stub at module scope.
   */
  getPostsFeed: (query: PostFeedQuery) => Promise<Post[]>
  /** The server lookup, which passes ranked Posts through the Post filter. */
  lookupPosts: (
    refs: { channelName: string; postId: number }[],
    filter: PostFilter,
  ) => Promise<Post[]>
  /**
   * The curve and settings the browser reads an Estimated View count through,
   * for ranked results. Asked for only when a views order will read one
   * (PFB-03).
   */
  getViewEstimate: () => Promise<ViewEstimate>
}

/**
 * Fetch + filter the posts in the current scope, on demand. This is the pure
 * core shared by `ScraperContext.getScopedPosts` (which wires live state into
 * it) and its unit tests. It performs no state writes and surfaces errors to
 * the caller instead of toasting/falling back — those UI concerns stay in
 * `handleFilterPosts`.
 */
export async function computeScopedPosts(
  deps: ScopedPostsDeps,
): Promise<Post[]> {
  const {
    searchText,
    semanticQuery,
    relatedPostSearch,
    embeddingsEnabled,
    selectedChannels,
    startDate,
    endDate,
    postFilter,
    postViewOptions,
    semanticSearchRespectsChannels,
    searchSimilarPosts,
    getPostsFeed,
    lookupPosts,
    getViewEstimate,
  } = deps

  // The ranked Posts a vector search returns pass through the Post filter, so
  // the filter means the same thing in both modes. The server evaluates it,
  // through the lookup, and the rank order is kept. Not the keyword: in
  // meaning mode the search box holds the meaning query.
  const readsEstimate = readsEstimatedViews(postViewOptions)
  const filterRanked = async (ranked: Post[]) => {
    let kept = ranked
    if (!isEmptyPostFilter(postFilter) && ranked.length > 0) {
      const shown = new Set(
        (
          await lookupPosts(
            ranked.map((p) => ({ channelName: p.channelName, postId: p.id })),
            postFilter,
          )
        ).map((p) => `${p.channelName}:${p.id}`),
      )
      kept = ranked.filter((p) => shown.has(`${p.channelName}:${p.id}`))
    }
    return buildFilteredPostsFromRaw(kept, {
      searchText: "",
      view: {
        ...postViewOptions,
        viewEstimate: readsEstimate ? await getViewEstimate() : null,
      },
      startDate,
      endDate,
    })
  }

  // Related-post ("more like this") search — bounded at 50 by the RAG call.
  //
  // It passes the window like every other path now (AW-01). It used to pass
  // nothing at all, which meant every Post ever: the second way a Posts path
  // silently meant all time, and the one with no control on screen admitting
  // to it. Both bounds are required by `searchSimilarPosts`, so a branch that
  // forgets them no longer compiles.
  if (embeddingsEnabled && relatedPostSearch) {
    const results = await searchSimilarPosts(relatedPostSearch.text, 50, {
      startDate,
      endDate,
    })
    const otherPosts = results.filter(
      (p) =>
        p.id !== relatedPostSearch.id ||
        p.channelName !== relatedPostSearch.channelName,
    )
    return filterRanked(otherPosts)
  }

  // Semantic search — bounded at 50 by the RAG call.
  if (embeddingsEnabled && semanticQuery.trim()) {
    const results = await searchSimilarPosts(semanticQuery, 50, {
      startDate,
      endDate,
      channels:
        semanticSearchRespectsChannels && selectedChannels.length > 0
          ? selectedChannels
          : undefined,
    })
    return filterRanked(results)
  }

  // Normal path: one bounded server-feed call (A1c): the keyword, the Post
  // filter, the per-channel cap and the order, all in SQL rather than after
  // paging a channel's whole history into the browser.
  //
  // `seed: 0` matches what `usePostsFeed` already sends. The client's random
  // cap seeded off the date range instead; that drift predates this change and
  // is tracked as P2 in `docs/discover-probe-queue-plan.md`, deliberately not
  // in this plan's scope.
  return getPostsFeed({
    channelNames: selectedChannels,
    startDate,
    endDate,
    keyword: searchText,
    filter: postFilter,
    viewMeasure: postViewOptions.viewMeasure,
    maxPerChannel: postViewOptions.maxPostsPerChannel,
    maxPerChannelMode: postViewOptions.maxPostsPerChannelMode,
    sort: postViewOptions.postSortOrder,
    groupByChannel: postViewOptions.groupByChannel,
    seed: 0,
    limit: SCOPED_POSTS_LIMIT,
  })
}
