/**
 * What to hand an AI endpoint as its posts (G1), and the Scope it submits.
 *
 * Always a **scope**: the window, the Post selection and the order, which the
 * backend resolves and assembles itself, so no posts cross the wire (PTR-05).
 * A meaning search used to be the exception, sending the ranked Posts; its
 * results reach an Action now as the Picks "Select all" records.
 *
 * It reads the Posts view the Posts view module builds (PVM-01); PVM-02
 * replaces it with plain functions of that view.
 *
 * The Post filter reaches `getScopedPosts`, which is what the tab shows, and
 * neither of the other two: it decides what the Posts tab shows and never what
 * an Artifact covers (PTR-03, ADR-026).
 */

import { useCallback, useRef } from "react"

import type { PromptScope } from "@/api/data"
import type { ScopeSubmission } from "@/client"
import { selectionBody } from "@/lib/posts/post-selection"
import {
  meaningQuery,
  type PostsView,
  relatedPost,
  respectsChannels,
} from "@/lib/posts/posts-view"
import {
  computeScopedPosts,
  type ScopedPostsDeps,
} from "@/lib/posts/scoped-posts"
import { toWireWindow } from "@/lib/scope/window"
import type { Post } from "@/types"

export interface PromptPostsDeps {
  /** The Posts view, no spotlight applied. */
  view: PostsView
  embeddingsEnabled: boolean
  searchSimilarPosts: ScopedPostsDeps["searchSimilarPosts"]
  getPostsFeed: ScopedPostsDeps["getPostsFeed"]
  lookupPosts: ScopedPostsDeps["lookupPosts"]
  getViewEstimate: ScopedPostsDeps["getViewEstimate"]
}

export type PromptPostsInput = { scope: PromptScope }

export interface PromptPosts {
  /**
   * Fetch what the tab shows, on demand. One identity until what it fetches
   * changes: never for a new minute of a Live window or a selection edit,
   * which it reads when called, so neither re-runs a meaning search (AW-04).
   */
  getScopedPosts: () => Promise<Post[]>
  getPromptPostsInput: () => Promise<PromptPostsInput>
  /**
   * The same Scope as a submission, for the server to freeze (AW-05). It
   * sends the canonical window, never the pair it currently resolves to:
   * flattening a Live window in the browser is the clock skew AW-02 removed,
   * reintroduced one layer up.
   */
  getScopeSubmission: (channels: string[]) => ScopeSubmission
}

export function usePromptPosts(deps: PromptPostsDeps): PromptPosts {
  const { view, embeddingsEnabled } = deps
  const { searchSimilarPosts, getPostsFeed, lookupPosts, getViewEstimate } =
    deps

  // Read when the call happens: the minute, and the selection, whose tick
  // the feed refreshes on its own.
  const latest = useRef(view)
  latest.current = view

  const {
    windowKey,
    scopeChannelNames,
    keyword,
    ranking,
    filter,
    maxPerChannel,
    maxPerChannelMode,
    sort,
    groupByChannel,
    viewMeasure,
    selection,
  } = view

  const getScopedPosts = useCallback(() => {
    const { startDate, endDate, selection: postSelection } = latest.current
    return computeScopedPosts({
      searchText: keyword,
      semanticQuery: meaningQuery(ranking),
      relatedPostSearch: relatedPost(ranking),
      semanticSearchRespectsChannels: respectsChannels(ranking),
      embeddingsEnabled,
      selectedChannels: scopeChannelNames,
      startDate,
      endDate,
      postSelection,
      postFilter: filter,
      postViewOptions: {
        maxPostsPerChannel: maxPerChannel,
        maxPostsPerChannelMode: maxPerChannelMode,
        postSortOrder: sort,
        groupByChannel,
        viewMeasure,
      },
      searchSimilarPosts,
      getPostsFeed,
      lookupPosts,
      getViewEstimate,
    })
  }, [
    // The window, not the minute it currently resolves to.
    windowKey,
    scopeChannelNames,
    keyword,
    ranking,
    filter,
    maxPerChannel,
    maxPerChannelMode,
    sort,
    groupByChannel,
    viewMeasure,
    embeddingsEnabled,
    searchSimilarPosts,
    getPostsFeed,
    lookupPosts,
    getViewEstimate,
  ])

  const { startDate, endDate } = view
  const getPromptPostsInput = useCallback(
    async (): Promise<PromptPostsInput> => ({
      scope: {
        startDate,
        endDate,
        selection,
        viewMeasure,
        sort,
        groupByChannel,
      },
    }),
    [startDate, endDate, selection, viewMeasure, sort, groupByChannel],
  )

  const getScopeSubmission = useCallback(
    (channels: string[]): ScopeSubmission => ({
      channels,
      window: toWireWindow(windowKey),
      viewMeasure,
      sort,
      groupByChannel,
      // The hand-written steps are the generated ones; the tree's ids ride
      // along untouched, as they do on the feed.
      selection: selectionBody(selection),
    }),
    [windowKey, viewMeasure, sort, groupByChannel, selection],
  )

  return { getScopedPosts, getPromptPostsInput, getScopeSubmission }
}
