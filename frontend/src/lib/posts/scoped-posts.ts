import type { Channel, Post } from "@/types"
import {
  applyForwardedFilter,
  applyPostViewPipeline,
  buildFilteredPostsFromRaw,
  type ForwardedFilterValue,
  type MediaFilterValue,
  type PostViewOptions,
} from "./post-view"

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
  getPostsByDateRange: (
    channelNames: string[],
    startDate: number,
    endDate: number,
    options?: { limit?: number },
  ) => Promise<Post[]>
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
    getPostsByDateRange,
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

  // Normal path: paged date-range read, then the full filter pipeline.
  const rawPosts = await getPostsByDateRange(
    selectedChannels,
    startDate,
    endDate,
  )
  return buildFilteredPostsFromRaw(rawPosts, {
    searchText,
    forwardedFilter,
    mediaFilter,
    channels,
    view: postViewOptions,
    startDate,
    endDate,
  })
}
