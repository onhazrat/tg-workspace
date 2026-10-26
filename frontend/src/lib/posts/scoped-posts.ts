import { hashKey } from "@tanstack/react-query"

import type { PostFeedQuery } from "@/api/data"
import type { ViewEstimate } from "@/lib/posts/estimated-views"
import type { Post } from "@/types"
import { type PostFilter, printPostFilter } from "./post-filter"
import {
  buildFilteredPostsFromRaw,
  type PostViewOptions,
  readsEstimatedViews,
} from "./post-pipeline"
import type { PostSelection } from "./post-selection"
import { meaningQuery, type PostsView, relatedPost } from "./posts-view"

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
 * What `fetchShownPosts` calls: the semantic search, the server feed and
 * lookup, and the view estimate. Injected so it is tested with a fake.
 */
export interface ShownPostsApi {
  /** Off, a ranking falls through to the shown read. */
  embeddingsEnabled: boolean
  searchSimilarPosts: (
    query: string,
    limit: number,
    options: { channels?: string[]; startDate: number; endDate: number },
  ) => Promise<Post[]>
  getPostsFeed: (query: PostFeedQuery) => Promise<Post[]>
  /**
   * The server lookup, which passes ranked Posts through the Post filter and
   * flags each with the Post selection, whose rules reach Posts in `scope`.
   */
  lookupPosts: (
    refs: { channelName: string; postId: number }[],
    filter: PostFilter,
    scope: {
      channelNames: string[]
      startDate: number
      endDate: number
      selection: PostSelection
    },
  ) => Promise<Post[]>
  /**
   * The curve and settings the browser reads an Estimated View count through,
   * for ranked results. Asked for only when a views order will read one
   * (PFB-03).
   */
  getViewEstimate: () => Promise<ViewEstimate>
}

/**
 * What a fetch of `view` depends on, as one string: everything but the
 * minute a Live window resolves to now and the Post selection, which the
 * fetch reads when it runs. The feed runs a meaning search again when this
 * moves and never otherwise (AW-04), so a new field of the view is in it
 * unless it is left out here.
 */
export function shownPostsKey(view: PostsView): string {
  const { startDate, endDate, selection, selectionRevision, ...rest } = view
  return hashKey([{ ...rest, filter: printPostFilter(view.filter) }])
}

/**
 * Fetch what the Posts tab shows under `view`, on demand: ranked by a
 * find-related or a meaning search, or the shown read. No spotlight: the
 * Scope's Channels and the Account's Post filter. It performs no state
 * writes and surfaces errors to the caller, whose fallback is the feed's to
 * choose.
 */
export async function fetchShownPosts(
  view: PostsView,
  api: ShownPostsApi,
): Promise<Post[]> {
  const { scopeChannelNames, startDate, endDate, filter, selection } = view
  const order: PostViewOptions = {
    maxPostsPerChannel: view.maxPerChannel,
    maxPostsPerChannelMode: view.maxPerChannelMode,
    postSortOrder: view.sort,
    groupByChannel: view.groupByChannel,
    viewMeasure: view.viewMeasure,
  }

  // The ranked Posts a vector search returns pass through the Post filter, so
  // the filter means the same thing in both modes, and come back flagged by
  // the Post selection. The server does both, through the lookup, and the
  // rank order is kept. Not the keyword: in meaning mode the search box holds
  // the meaning query.
  const filterRanked = async (ranked: Post[]) => {
    let kept: Post[] = []
    if (ranked.length > 0) {
      const shown = new Map(
        (
          await api.lookupPosts(
            ranked.map((p) => ({ channelName: p.channelName, postId: p.id })),
            filter,
            { channelNames: scopeChannelNames, startDate, endDate, selection },
          )
        ).map((p) => [`${p.channelName}:${p.id}`, p]),
      )
      kept = ranked.flatMap((p) => shown.get(`${p.channelName}:${p.id}`) ?? [])
    }
    return buildFilteredPostsFromRaw(kept, {
      searchText: "",
      view: {
        ...order,
        viewEstimate: readsEstimatedViews(order)
          ? await api.getViewEstimate()
          : null,
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
  const related = relatedPost(view.ranking)
  if (api.embeddingsEnabled && related) {
    const results = await api.searchSimilarPosts(related.text, 50, {
      startDate,
      endDate,
    })
    return filterRanked(
      results.filter(
        (p) => p.id !== related.id || p.channelName !== related.channelName,
      ),
    )
  }

  // Semantic search — bounded at 50 by the RAG call.
  const query = meaningQuery(view.ranking)
  if (api.embeddingsEnabled && query.trim()) {
    const results = await api.searchSimilarPosts(query, 50, {
      startDate,
      endDate,
      channels:
        view.respectsChannels && scopeChannelNames.length > 0
          ? scopeChannelNames
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
  return api.getPostsFeed({
    channelNames: scopeChannelNames,
    startDate,
    endDate,
    keyword: view.keyword,
    filter,
    viewMeasure: view.viewMeasure,
    maxPerChannel: view.maxPerChannel,
    maxPerChannelMode: view.maxPerChannelMode,
    sort: view.sort,
    groupByChannel: view.groupByChannel,
    seed: 0,
    limit: SCOPED_POSTS_LIMIT,
    selection,
  })
}
