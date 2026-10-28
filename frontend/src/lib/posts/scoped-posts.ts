import { hashKey } from "@tanstack/react-query"

import type { ViewEstimate } from "@/lib/posts/estimated-views"
import type { Post } from "@/types"
import { type PostFilter, printPostFilter } from "./post-filter"
import {
  buildFilteredPostsFromRaw,
  type PostViewOptions,
  readsEstimatedViews,
} from "./post-pipeline"
import type { PostSelection } from "./post-selection"
// Types only: `posts-view.ts` builds the Ranking's query from this module.
import type { PostsView } from "./posts-view"

/**
 * What `fetchRanking` calls: the vector search, the server lookup and the
 * view estimate. Injected so it is tested with a fake.
 */
export interface RankingApi {
  searchSimilarPosts: (
    query: string,
    limit: number,
    options: { channels?: string[]; startDate: number; endDate: number },
  ) => Promise<Post[]>
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
 * What a Ranking's fetch of `view` depends on, as one string: everything but
 * the minute a Live window resolves to now and the Post selection, which the
 * fetch reads when it runs. The Ranking's query runs again when this moves
 * and never otherwise (AW-04), so a new field of the view is in it unless it
 * is left out here.
 */
export function rankingKey(view: PostsView): string {
  const { startDate, endDate, selection, selectionRevision, ...rest } = view
  return hashKey([{ ...rest, filter: printPostFilter(view.filter) }])
}

/**
 * Fetch the Posts `view`'s Ranking shows: a find-related's or a meaning
 * search's, at most 50, through the Post filter and flagged by the Post
 * selection. No spotlight: the Scope's Channels. Nothing without a Ranking;
 * the server's feed is `posts-view.ts`'s. It performs no state writes and
 * surfaces errors to the caller.
 */
export async function fetchRanking(
  view: PostsView,
  api: RankingApi,
): Promise<Post[]> {
  const { scopeChannelNames, startDate, endDate, filter, selection, ranking } =
    view
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
  if (ranking.kind === "related") {
    const related = ranking.post
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
  if (ranking.kind === "meaning") {
    const results = await api.searchSimilarPosts(ranking.query, 50, {
      startDate,
      endDate,
      channels:
        view.respectsChannels && scopeChannelNames.length > 0
          ? scopeChannelNames
          : undefined,
    })
    return filterRanked(results)
  }
  return []
}
