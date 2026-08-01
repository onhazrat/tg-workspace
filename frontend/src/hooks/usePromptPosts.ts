/**
 * What to hand an AI endpoint as its posts (G1).
 *
 * Two shapes, and which one you get is the whole point:
 *
 * - **`scope`** — the ordinary path. The backend resolves the scope and
 *   assembles the posts block itself, so no posts cross the wire.
 * - **`posts`** — the semantic/related path. Vector ranking is the one
 *   selection the server cannot derive from a scope, so the client resolves
 *   which posts matched and the caller formats them.
 *
 * Extracted from `ScraperContext` for G1. The split it encodes is the same one
 * the Discover and feed paths already make; see `computeScopedPosts` and
 * `usePostsFeed`.
 */

import { useCallback } from "react"

import type { PromptScope } from "@/api/data"
import type {
  ForwardedFilterValue,
  MediaFilterValue,
  PostViewOptions,
} from "@/lib/posts/post-view"
import { computeScopedPosts } from "@/lib/posts/scoped-posts"
import type { Channel, Post } from "@/types"

export interface PromptPostsDeps {
  channels: Channel[]
  selectedChannels: Set<string>
  startDate: number
  endDate: number
  embeddingsEnabled: boolean
  debouncedPostSearch: string
  debouncedSemanticSearchQuery: string
  relatedPostSearch: Post | null
  forwardedFilter: ForwardedFilterValue
  mediaFilter: MediaFilterValue
  postViewOptions: PostViewOptions
  semanticSearchRespectsTimeRange: boolean
  semanticSearchRespectsChannels: boolean
  searchSimilarPosts: (
    query: string,
    limit?: number,
    options?: { channels?: string[]; startDate?: number; endDate?: number },
  ) => Promise<Post[]>
  getPostsFeed: typeof import("@/api").api.getPostsFeed
}

export type PromptPostsInput =
  | { posts: Post[]; scope?: undefined }
  | { posts?: undefined; scope: PromptScope }

export interface PromptPosts {
  getScopedPosts: (
    searchText?: string,
    semanticQuery?: string,
  ) => Promise<Post[]>
  getPromptPostsInput: () => Promise<PromptPostsInput>
}

export function usePromptPosts(deps: PromptPostsDeps): PromptPosts {
  const {
    channels,
    selectedChannels,
    startDate,
    endDate,
    embeddingsEnabled,
    debouncedPostSearch,
    debouncedSemanticSearchQuery,
    relatedPostSearch,
    forwardedFilter,
    mediaFilter,
    postViewOptions,
    semanticSearchRespectsTimeRange,
    semanticSearchRespectsChannels,
    searchSimilarPosts,
    getPostsFeed,
  } = deps

  const { maxPostsPerChannel, maxPostsPerChannelMode, postSortOrder } =
    postViewOptions

  const getScopedPosts = useCallback(
    async (
      searchText = debouncedPostSearch,
      semanticQuery = debouncedSemanticSearchQuery,
    ): Promise<Post[]> =>
      computeScopedPosts({
        searchText,
        semanticQuery,
        relatedPostSearch,
        embeddingsEnabled,
        selectedChannels: Array.from(selectedChannels),
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
      }),
    [
      startDate,
      endDate,
      selectedChannels,
      debouncedPostSearch,
      debouncedSemanticSearchQuery,
      relatedPostSearch,
      embeddingsEnabled,
      semanticSearchRespectsTimeRange,
      semanticSearchRespectsChannels,
      searchSimilarPosts,
      getPostsFeed,
      forwardedFilter,
      channels,
      mediaFilter,
      // `postViewOptions` is rebuilt every render, so depend on its fields.
      // Depending on the object would defeat the memo entirely.
      postViewOptions,
      maxPostsPerChannel,
      maxPostsPerChannelMode,
      postSortOrder,
    ],
  )

  const getPromptPostsInput =
    useCallback(async (): Promise<PromptPostsInput> => {
      const semanticActive =
        embeddingsEnabled &&
        (!!relatedPostSearch || !!debouncedSemanticSearchQuery.trim())
      if (semanticActive) {
        return { posts: await getScopedPosts() }
      }
      return {
        scope: {
          startDate,
          endDate,
          keyword: debouncedPostSearch,
          forwarded: forwardedFilter,
          media: mediaFilter,
          maxPerChannel: maxPostsPerChannel,
          maxPerChannelMode: maxPostsPerChannelMode,
          sort: postSortOrder,
          seed: 0,
        },
      }
    }, [
      embeddingsEnabled,
      relatedPostSearch,
      debouncedSemanticSearchQuery,
      getScopedPosts,
      startDate,
      endDate,
      debouncedPostSearch,
      forwardedFilter,
      mediaFilter,
      maxPostsPerChannel,
      maxPostsPerChannelMode,
      postSortOrder,
    ])

  return { getScopedPosts, getPromptPostsInput }
}
