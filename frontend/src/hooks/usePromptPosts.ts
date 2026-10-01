/**
 * What to hand an AI endpoint as its posts (G1), and the Scope it submits.
 *
 * Always a **scope**: the window, the Post selection and the order, which the
 * backend resolves and assembles itself, so no posts cross the wire (PTR-05).
 * A meaning search used to be the exception, sending the ranked Posts; its
 * results reach an Action now as the Picks "Select all" records.
 *
 * Extracted from `ScraperContext` for G1.
 *
 * The Post filter reaches `getScopedPosts`, which is what the tab shows, and
 * neither of the other two: it decides what the Posts tab shows and never what
 * an Artifact covers (PTR-03, ADR-026).
 */

import { useCallback, useRef } from "react"

import type { PromptScope } from "@/api/data"
import type { ScopeSubmission } from "@/client"
import type { PostFilter } from "@/lib/posts/post-filter"
import { type PostSelection, selectionBody } from "@/lib/posts/post-selection"
import type { PostViewOptions } from "@/lib/posts/post-view"
import {
  computeScopedPosts,
  type ScopedPostsDeps,
} from "@/lib/posts/scoped-posts"
import { toWireWindow, type WindowState } from "@/lib/scope/window"
import type { Post } from "@/types"

export interface PromptPostsDeps {
  selectedChannels: Set<string>
  startDate: number
  endDate: number
  /**
   * The canonical Analysis window, as the identity of `startDate`/`endDate`
   * rather than their current value (AW-04).
   *
   * A Live window resolves to a new pair every minute, so memoising on the pair
   * churns `getScopedPosts`'s identity once a minute — and two effects in
   * `usePostsView` plus one in `useEntityFlow` depend on it. That re-ran the
   * whole client vector path, in five mount points, every 60 seconds, and a
   * transient failure there clears the Account's search.
   */
  windowKey: WindowState
  embeddingsEnabled: boolean
  debouncedPostSearch: string
  debouncedSemanticSearchQuery: string
  relatedPostSearch: Post | null
  postFilter: PostFilter
  /** What an Action covers (PTR-05). */
  postSelection: PostSelection
  postViewOptions: PostViewOptions
  semanticSearchRespectsChannels: boolean
  searchSimilarPosts: (
    query: string,
    limit: number,
    options: { channels?: string[]; startDate: number; endDate: number },
  ) => Promise<Post[]>
  getPostsFeed: typeof import("@/api").api.getPostsFeed
  lookupPosts: ScopedPostsDeps["lookupPosts"]
  getViewEstimate: ScopedPostsDeps["getViewEstimate"]
}

export type PromptPostsInput = { scope: PromptScope }

export interface PromptPosts {
  getScopedPosts: (
    searchText?: string,
    semanticQuery?: string,
  ) => Promise<Post[]>
  getPromptPostsInput: () => Promise<PromptPostsInput>
  /**
   * The same Scope as a submission, for the server to freeze (AW-05).
   *
   * Here rather than at the call site because this hook already holds every
   * filter that shapes the selection — a second assembly somewhere else is how
   * an Artifact ends up recording a Scope that is not the one it was made
   * from. It sends the canonical window, never the pair it currently resolves
   * to: flattening a Live window in the browser is the clock skew AW-02
   * removed, reintroduced one layer up.
   */
  getScopeSubmission: (channels: string[]) => ScopeSubmission
}

export function usePromptPosts(deps: PromptPostsDeps): PromptPosts {
  const {
    selectedChannels,
    startDate,
    endDate,
    windowKey,
    embeddingsEnabled,
    debouncedPostSearch,
    debouncedSemanticSearchQuery,
    relatedPostSearch,
    postFilter,
    postSelection,
    postViewOptions,
    semanticSearchRespectsChannels,
    searchSimilarPosts,
    getPostsFeed,
    lookupPosts,
    getViewEstimate,
  } = deps

  // Read when the call happens, not when the memo was built, so a minute that
  // has passed since is still reflected in what gets fetched. The selection
  // too: a tick changes only the flags, which the feed refreshes on its own,
  // and must not re-run a meaning search.
  const boundsRef = useRef({ startDate, endDate, postSelection })
  boundsRef.current = { startDate, endDate, postSelection }

  const {
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
    groupByChannel,
    viewMeasure,
  } = postViewOptions

  const scopedPosts = useCallback(
    async (
      filter: PostFilter,
      searchText = debouncedPostSearch,
      semanticQuery = debouncedSemanticSearchQuery,
    ): Promise<Post[]> =>
      computeScopedPosts({
        searchText,
        semanticQuery,
        relatedPostSearch,
        embeddingsEnabled,
        selectedChannels: Array.from(selectedChannels),
        startDate: boundsRef.current.startDate,
        endDate: boundsRef.current.endDate,
        postSelection: boundsRef.current.postSelection,
        postFilter: filter,
        postViewOptions,
        semanticSearchRespectsChannels,
        searchSimilarPosts,
        getPostsFeed,
        lookupPosts,
        getViewEstimate,
      }),
    [
      // The window, not the minute it currently resolves to — see `windowKey`.
      windowKey,
      selectedChannels,
      debouncedPostSearch,
      debouncedSemanticSearchQuery,
      relatedPostSearch,
      embeddingsEnabled,
      semanticSearchRespectsChannels,
      searchSimilarPosts,
      getPostsFeed,
      lookupPosts,
      getViewEstimate,
      // `postViewOptions` is rebuilt every render, so depend on its fields.
      // Depending on the object would defeat the memo entirely.
      postViewOptions,
      maxPostsPerChannel,
      maxPostsPerChannelMode,
      postSortOrder,
      groupByChannel,
      viewMeasure,
    ],
  )

  const getScopedPosts = useCallback(
    (searchText?: string, semanticQuery?: string) =>
      scopedPosts(postFilter, searchText, semanticQuery),
    [scopedPosts, postFilter],
  )

  const getPromptPostsInput = useCallback(
    async (): Promise<PromptPostsInput> => ({
      scope: {
        startDate,
        endDate,
        selection: postSelection,
        viewMeasure,
        sort: postSortOrder,
        groupByChannel,
      },
    }),
    [
      startDate,
      endDate,
      postSelection,
      viewMeasure,
      postSortOrder,
      groupByChannel,
    ],
  )

  const getScopeSubmission = useCallback(
    (channels: string[]): ScopeSubmission => ({
      channels,
      window: toWireWindow(windowKey),
      viewMeasure,
      sort: postSortOrder,
      groupByChannel,
      // The hand-written steps are the generated ones; the tree's ids ride
      // along untouched, as they do on the feed.
      selection: selectionBody(postSelection),
    }),
    [windowKey, viewMeasure, postSortOrder, groupByChannel, postSelection],
  )

  return { getScopedPosts, getPromptPostsInput, getScopeSubmission }
}
