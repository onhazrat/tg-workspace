import type { PostFeedQuery } from "@/api/data"
import type { Channel, Post } from "@/types"
import {
  applyForwardedFilter,
  applyPostViewPipeline,
  type ForwardedFilterValue,
  type MediaFilterValue,
  type PostViewOptions,
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
  forwardedFilter: ForwardedFilterValue
  mediaFilter: MediaFilterValue
  channels: Channel[]
  postViewOptions: PostViewOptions
  semanticSearchRespectsTimeRange: boolean
  semanticSearchRespectsChannels: boolean
  searchSimilarPosts: (
    query: string,
    limit?: number,
    options?: { channels?: string[]; startDate?: number; endDate?: number },
  ) => Promise<Post[]>
  /**
   * The server feed. Injected rather than imported so the branch stays
   * testable without a network stub at module scope.
   */
  getPostsFeed: (query: PostFeedQuery) => Promise<Post[]>
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
    forwardedFilter,
    mediaFilter,
    channels,
    postViewOptions,
    semanticSearchRespectsTimeRange,
    semanticSearchRespectsChannels,
    searchSimilarPosts,
    getPostsFeed,
  } = deps

  // Related-post ("more like this") search — bounded at 50 by the RAG call.
  if (embeddingsEnabled && relatedPostSearch) {
    const results = await searchSimilarPosts(relatedPostSearch.text, 50)
    const otherPosts = results.filter(
      (p) =>
        p.id !== relatedPostSearch.id ||
        p.channelName !== relatedPostSearch.channelName,
    )
    return applyPostViewPipeline(
      applyForwardedFilter(otherPosts, forwardedFilter, channels),
      postViewOptions,
      { startDate, endDate },
    )
  }

  // Semantic search — bounded at 50 by the RAG call.
  if (embeddingsEnabled && semanticQuery.trim()) {
    const results = await searchSimilarPosts(semanticQuery, 50, {
      startDate: semanticSearchRespectsTimeRange ? startDate : undefined,
      endDate: semanticSearchRespectsTimeRange ? endDate : undefined,
      channels:
        semanticSearchRespectsChannels && selectedChannels.length > 0
          ? selectedChannels
          : undefined,
    })
    return applyPostViewPipeline(
      applyForwardedFilter(results, forwardedFilter, channels),
      postViewOptions,
      { startDate, endDate },
    )
  }

  // Normal path: one bounded server-feed call (A1c). Every stage of the old
  // client pipeline — keyword, forwarded, media, per-channel cap, sort — has a
  // server counterpart kept in lockstep by `app/services/post_filters.py`, so
  // this is the same selection with the filtering done in SQL rather than after
  // paging a channel's whole history into the browser.
  //
  // `channels` is no longer read here: the `unfollowed_forwarded` filter needed
  // the local channel list to decide what "followed" means, and the server now
  // resolves that from `tg_channels` itself.
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
    forwarded: forwardedFilter,
    media: mediaFilter,
    maxPerChannel: postViewOptions.maxPostsPerChannel,
    maxPerChannelMode: postViewOptions.maxPostsPerChannelMode,
    sort: postViewOptions.postSortOrder,
    seed: 0,
    limit: SCOPED_POSTS_LIMIT,
  })
}
