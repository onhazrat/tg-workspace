/**
 * The Posts view (ADR-036): everything a Posts read is evaluated under, and
 * `postsRead`, which builds a read's query key and request body together so
 * the two cannot drift.
 *
 * The key departs from the body in exactly three ways:
 *
 * - **The window by `windowKey`**, not the boundaries it resolves to now. A
 *   Live window resolves to a new pair every minute (AW-04); a key built from
 *   the pair would remount the infinite feed at page one every minute and mint
 *   a cache entry per minute per filter. The body still carries the fresh
 *   pair, because a query function is read from the latest render.
 * - **The Post selection by `selectionRevision`**, not its Picks, which can
 *   run to 5,000. The feed keys neither: an edit patches or refetches the
 *   loaded pages (PTR-05), and a new key would drop the Account to the top.
 * - **The Post filter by its printed text**, which is stable where the tree's
 *   ids are not.
 *
 * `posts-view.test.ts` holds every kind to that, field by field.
 */

import { postScopeBody, postsFeedBody, shownPostsBody } from "@/api/data"
import { queryKeys } from "@/hooks/queryKeys"
import type { WindowHistogramQuery } from "@/lib/analysis-window"
import type { WindowState } from "@/lib/scope/window"
import type { Post } from "@/types"
import {
  type PostFilter,
  type PostNumber,
  printPostFilter,
} from "./post-filter"
import type {
  MaxPostsPerChannelMode,
  PostSortOrder,
  ViewMeasure,
} from "./post-pipeline"
import type { PostSelection } from "./post-selection"

/**
 * How the tab ranks what it shows: not at all, by a meaning query, or by a
 * related Post. One value, so the two can never both be set.
 */
export type PostsRanking =
  | { kind: "none" }
  | { kind: "meaning"; query: string; respectsChannels: boolean }
  | { kind: "related"; post: Post }

export const NO_RANKING: PostsRanking = { kind: "none" }

/** Whether a meaning query keeps to the selected Channels; false otherwise. */
export const respectsChannels = (ranking: PostsRanking): boolean =>
  ranking.kind === "meaning" && ranking.respectsChannels

/**
 * A meaning search for `query`, keeping whether the one it replaces kept to
 * the selected Channels.
 */
export const meaningRanking =
  (query: string) =>
  (current: PostsRanking): PostsRanking => ({
    kind: "meaning",
    query,
    respectsChannels: respectsChannels(current),
  })

/** What a meaning search asks for, or "" when none is running. */
export const meaningQuery = (ranking: PostsRanking): string =>
  ranking.kind === "meaning" ? ranking.query : ""

/** What a related-Post search ranks by, or null. */
export const relatedPost = (ranking: PostsRanking): Post | null =>
  ranking.kind === "related" ? ranking.post : null

/** What every Posts read is evaluated under, a Channel spotlight applied. */
export interface PostsView {
  /** The selected Channels, which the Scope covers whatever a spotlight shows. */
  scopeChannelNames: string[]
  /** What the tab shows: the selected Channels, or the spotlit one. */
  channelNames: string[]
  /** Debounced once, in the Posts view module. */
  keyword: string
  /** The reads that count or filter ignore it. */
  ranking: PostsRanking
  filter: PostFilter
  maxPerChannel: number
  maxPerChannelMode: MaxPostsPerChannelMode
  sort: PostSortOrder
  groupByChannel: boolean
  viewMeasure: ViewMeasure
  startDate: number
  endDate: number
  windowKey: WindowState
  selection: PostSelection
  /** Moves on every selection edit. */
  selectionRevision: number
}

/** The order and cap, edited as one value. */
export type PostsOrder = Pick<
  PostsView,
  | "sort"
  | "groupByChannel"
  | "viewMeasure"
  | "maxPerChannel"
  | "maxPerChannelMode"
>

/**
 * The reads, each with its own inputs. The histograms read the uncapped view:
 * neither sends the cap.
 */
export type PostsRead =
  | { kind: "feed"; selectedFirst?: boolean }
  | { kind: "shownCounts" }
  | { kind: "scopeCounts" }
  | { kind: "facets" }
  | {
      kind: "valueHistogram"
      measure: PostNumber
      /** Bin only this range, on the scale first drawn (TB-04). */
      zoom?: { lo: number; hi: number; log: boolean } | null
    }
  | { kind: "windowHistogram"; query: WindowHistogramQuery }

export function postsRead(
  view: PostsView,
  read: PostsRead,
): { queryKey: readonly unknown[]; body: Record<string, unknown> } {
  const { channelNames, keyword, filter, startDate, endDate, selection } = view
  const window = view.windowKey
  const printed = printPostFilter(filter)
  // Which Posts the cap keeps and in what order: what the tab shows.
  const shown = {
    channelNames,
    keyword,
    maxPerChannel: view.maxPerChannel,
    maxPerChannelMode: view.maxPerChannelMode,
    sort: view.sort,
    viewMeasure: view.viewMeasure,
    seed: 0,
  }
  switch (read.kind) {
    case "feed": {
      const feed = {
        ...shown,
        groupByChannel: view.groupByChannel,
        selectedFirst: read.selectedFirst ?? false,
      }
      return {
        queryKey: queryKeys.postsFeed({ ...feed, filter: printed, window }),
        body: postsFeedBody({ ...feed, filter, startDate, endDate, selection }),
      }
    }
    case "shownCounts":
      return {
        queryKey: queryKeys.postsCounts({
          ...shown,
          filter: printed,
          window,
          selection: view.selectionRevision,
        }),
        body: shownPostsBody({
          ...shown,
          filter,
          startDate,
          endDate,
          selection,
        }),
      }
    // The Scope's: what an Action covers, so neither the Post filter nor a
    // spotlight is in it (ADR-026).
    case "scopeCounts": {
      const names = view.scopeChannelNames
      return {
        queryKey: queryKeys.postsCounts({
          channelNames: names,
          window,
          selection: view.selectionRevision,
        }),
        body: postScopeBody({
          channelNames: names,
          startDate,
          endDate,
          selection,
        }),
      }
    }
    // Filters aside, though a spotlight's window is its Channel's.
    case "facets":
      return {
        queryKey: queryKeys.postsFacets({
          channelNames,
          window,
          selection: view.selectionRevision,
        }),
        body: postScopeBody({ channelNames, startDate, endDate, selection }),
      }
    // Filters aside, so the bars hold still while another Condition changes;
    // Channel posts in filtered window counts what the filter keeps (PTI-02).
    case "valueHistogram": {
      const { measure, zoom } = read
      const filtered = measure === "channel_posts_filtered"
      return {
        queryKey: queryKeys.postsValueHistogram({
          channelNames,
          window,
          measure,
          ...zoom,
          ...(filtered ? { keyword, filter: printed } : {}),
        }),
        body: {
          ...postScopeBody({
            channelNames,
            startDate,
            endDate,
            ...(filtered ? { keyword, filter } : {}),
          }),
          measure,
          ...zoom,
        },
      }
    }
    // Unfiltered, every Post of the selected Channels.
    case "windowHistogram": {
      const { query } = read
      const names = query.unfiltered ? view.scopeChannelNames : channelNames
      const filters = query.unfiltered ? {} : { keyword, filter }
      return {
        queryKey: queryKeys.postsWindowHistogram({
          ...query,
          channelNames: names,
          ...(query.unfiltered ? {} : { keyword, filter: printed }),
          window,
        }),
        body: {
          ...postScopeBody({
            channelNames: names,
            startDate,
            endDate,
            ...filters,
          }),
          ...query,
        },
      }
    }
  }
}
