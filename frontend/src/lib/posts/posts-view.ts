/**
 * The Posts view (ADR-036) and the Posts read module (PRM-01): everything a
 * Posts read is evaluated under, and for each read of what the Posts tab
 * shows, which source serves it (`servedBy`), its query key and typed request
 * body together so the two cannot drift (`postsRead`), and its complete query
 * options (`postsQuery`, `feedQuery`, `rankingQuery`). Nothing else names a
 * Posts read endpoint; `architecture-invariants.test.ts` holds it to that.
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

import {
  infiniteQueryOptions,
  keepPreviousData,
  type QueryClient,
  queryOptions,
} from "@tanstack/react-query"

import {
  dataApi,
  postScopeBody,
  postsFeedBody,
  shownPostsBody,
} from "@/api/data"
import {
  dataPostsCounts,
  dataPostsFacets,
  dataPostsValueHistogram,
  dataPostsWindowHistogram,
  type PostCountsResponse,
  type PostFacetsRequest,
  type PostFacetsResponse,
  type PostFeedRequest,
  type PostFilteredRequest,
  type PostValueHistogramRequest,
  type PostValueHistogramResponse,
  type PostWindowHistogramRequest,
  type ScopeSubmission,
} from "@/client"
import { queryKeys, SUMMARIZER_STALE_TIME } from "@/hooks/queryKeys"
import type { WindowHistogramQuery } from "@/lib/analysis-window"
import { toWireWindow, type WindowState } from "@/lib/scope/window"
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
import { type PostSelection, selectionBody } from "./post-selection"
import { fetchRanking, type RankingApi, rankingKey } from "./scoped-posts"
import { EXPORT_LIMIT } from "./selected-export"

/**
 * How the tab ranks what it shows: not at all, by a meaning query, or by a
 * related Post. One value, so the two can never both be set.
 */
export type PostsRanking =
  | { kind: "none" }
  | { kind: "meaning"; query: string }
  | { kind: "related"; post: Post }

export const NO_RANKING: PostsRanking = { kind: "none" }

/**
 * One ranking edit: a new ranking, the Account's "respects Channels" choice
 * for every meaning search, or both. What it leaves out it keeps.
 */
export type RankingEdit = {
  ranking?: PostsRanking
  respectsChannels?: boolean
}

/**
 * The Ranking as the Semantic search Setting allows it: none while the
 * Setting is off. The Posts view module builds the view through this, so no
 * read sees a Ranking with the Setting off.
 */
export const withSemanticSearch = (
  ranking: PostsRanking,
  semanticSearch: boolean,
): PostsRanking => (semanticSearch ? ranking : NO_RANKING)

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
  /**
   * Whether a meaning search keeps to the selected Channels: the Account's
   * choice, held while no search runs so the next one uses it.
   */
  respectsChannels: boolean
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

/** The one rule for whether the Posts view is ranked. */
export const isRanked = (view: Pick<PostsView, "ranking">): boolean =>
  view.ranking.kind !== "none"

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
 * The Scope an Action asks the server to freeze (AW-05): `channels`, the
 * view's window, order and selection. It sends the canonical window, never
 * the pair it currently resolves to: flattening a Live window in the browser
 * is the clock skew AW-02 removed, reintroduced one layer up.
 */
export const scopeSubmission = (
  view: PostsView,
  channels: string[],
): ScopeSubmission => ({
  channels,
  window: toWireWindow(view.windowKey),
  viewMeasure: view.viewMeasure,
  sort: view.sort,
  groupByChannel: view.groupByChannel,
  // The hand-written steps are the generated ones; the tree's ids ride
  // along untouched, as they do on the feed.
  selection: selectionBody(view.selection),
})

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
  /** The command palette's Find related Posts list: the feed's first 100. */
  | { kind: "pickPool" }
  /** What Copy links and Export Markdown take (PTR-06). */
  | { kind: "selectedShown" }

/** What each read sends. */
interface PostsReadBody {
  feed: PostFeedRequest
  pickPool: PostFeedRequest
  selectedShown: PostFeedRequest
  shownCounts: PostFilteredRequest
  scopeCounts: PostFilteredRequest
  facets: PostFacetsRequest
  valueHistogram: PostValueHistogramRequest
  windowHistogram: PostWindowHistogramRequest
}

type ReadKind = PostsRead["kind"]

/** One page of the infinite Posts feed. */
export const FEED_PAGE_SIZE = 20

export const PICK_POOL_LIMIT = 100

/**
 * The reads a Ranking answers while there is one: what the tab shows and its
 * count. The Scope counts, the facets and the histograms only count or filter,
 * so they read the same with or without one.
 */
const RANKED_READS: ReadonlySet<ReadKind> = new Set([
  "feed",
  "shownCounts",
  "pickPool",
  "selectedShown",
])

/** Which source answers `read` under `view`: the Ranking's results or the server. */
export const servedBy = (
  view: PostsView,
  read: PostsRead,
): "ranking" | "server" =>
  isRanked(view) && RANKED_READS.has(read.kind) ? "ranking" : "server"

export function postsRead<R extends PostsRead>(
  view: PostsView,
  read: R,
): { queryKey: readonly unknown[]; body: PostsReadBody[R["kind"]] }
export function postsRead(
  view: PostsView,
  read: PostsRead,
): { queryKey: readonly unknown[]; body: PostsReadBody[ReadKind] } {
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
  const feed = {
    ...shown,
    groupByChannel: view.groupByChannel,
    selectedFirst: read.kind === "feed" && (read.selectedFirst ?? false),
  }
  const feedBody = postsFeedBody({
    ...feed,
    filter,
    startDate,
    endDate,
    selection,
  })
  switch (read.kind) {
    case "feed":
      return {
        queryKey: queryKeys.postsFeed({ ...feed, filter: printed, window }),
        body: feedBody,
      }
    // The feed's body, so the list can never drift from the feed.
    case "pickPool":
      return {
        queryKey: queryKeys.postsPickPool({ ...feed, filter: printed, window }),
        body: { ...feedBody, limit: PICK_POOL_LIMIT },
      }
    case "selectedShown":
      return {
        queryKey: queryKeys.postsSelectedShown({
          ...feed,
          filter: printed,
          window,
          selection: view.selectionRevision,
        }),
        body: { ...feedBody, onlySelected: true, limit: EXPORT_LIMIT },
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

type ServerRead = Exclude<PostsRead, { kind: "feed" }>

/** What each server read answers with. */
interface PostsReadData {
  shownCounts: PostCountsResponse
  scopeCounts: PostCountsResponse
  facets: PostFacetsResponse
  valueHistogram: PostValueHistogramResponse
  windowHistogram: number[]
  pickPool: Post[]
  selectedShown: Post[]
}

/** The call that answers a server read. */
function send(
  view: PostsView,
  read: ServerRead,
): () => Promise<PostsReadData[ServerRead["kind"]]> {
  switch (read.kind) {
    case "shownCounts":
    case "scopeCounts": {
      const { body } = postsRead(view, read)
      return () => dataPostsCounts({ body })
    }
    case "facets": {
      const { body } = postsRead(view, read)
      return () => dataPostsFacets({ body })
    }
    case "valueHistogram": {
      const { body } = postsRead(view, read)
      return () => dataPostsValueHistogram({ body })
    }
    case "windowHistogram": {
      const { body } = postsRead(view, read)
      return async () => (await dataPostsWindowHistogram({ body })).counts
    }
    case "pickPool":
    case "selectedShown": {
      const { body } = postsRead(view, read)
      return () => dataApi.getPostsFeedBody(body)
    }
  }
}

/** The Channels a server read covers; with none it does not run. */
function channelsOf(view: PostsView, read: ServerRead): string[] {
  if (read.kind === "valueHistogram") return view.channelNames
  if (read.kind === "windowHistogram" && !read.query.unfiltered)
    return view.channelNames
  return view.scopeChannelNames
}

/**
 * A server read's query options. Off while the Ranking serves the read, or
 * with no Channels to read.
 */
export function postsQuery<R extends ServerRead>(
  view: PostsView,
  read: R,
): ServerQuery<PostsReadData[R["kind"]]>
export function postsQuery(
  view: PostsView,
  read: ServerRead,
): ServerQuery<PostsReadData[ServerRead["kind"]]> {
  return {
    queryKey: postsRead(view, read).queryKey,
    queryFn: send(view, read),
    enabled:
      servedBy(view, read) === "server" && channelsOf(view, read).length > 0,
    staleTime: SUMMARIZER_STALE_TIME,
    placeholderData: keepPreviousData,
  }
}

/**
 * Spelled out rather than built with `queryOptions`: `postsQuery`'s overload
 * gives each read its own data type, and one `queryOptions` call over the
 * switch would hand every caller the union.
 */
interface ServerQuery<T> {
  queryKey: readonly unknown[]
  queryFn: () => Promise<T>
  enabled: boolean
  staleTime: number
  placeholderData: typeof keepPreviousData
}

/**
 * The server's infinite feed, `FEED_PAGE_SIZE` Posts a page. The selection
 * rides the body and not the key: an edit refreshes the rows in place
 * (PTR-05). Off while ranked.
 */
export const feedQuery = (view: PostsView, selectedFirst: boolean) => {
  const { queryKey, body } = postsRead(view, { kind: "feed", selectedFirst })
  return infiniteQueryOptions({
    queryKey,
    queryFn: ({ pageParam }) =>
      dataApi.getPostsFeedBody({
        ...body,
        limit: FEED_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage: Post[], allPages: Post[][]) =>
      lastPage.length < FEED_PAGE_SIZE
        ? undefined
        : allPages.length * FEED_PAGE_SIZE,
    enabled: !isRanked(view),
    staleTime: SUMMARIZER_STALE_TIME,
  })
}

/**
 * The Ranking's read: one vector search and one lookup per query, shared by
 * the feed, the shown counts and the pick-post list. Keyed by
 * `rankingKey`, which leaves out the minute a Live window resolves to and
 * the Post selection, and outside `queryKeys.postViews`, so neither a sync, a
 * Live minute nor an AI run searches again (AW-04, story 5). No spotlight:
 * the Scope's Channels. A failure ends the Ranking, so it is not retried.
 */
export const rankingQuery = (view: PostsView, api: RankingApi) =>
  queryOptions({
    queryKey: queryKeys.postsRanking(rankingKey(view)),
    queryFn: () => fetchRanking(view, api),
    enabled: isRanked(view),
    staleTime: SUMMARIZER_STALE_TIME,
    retry: false,
    refetchOnWindowFocus: false,
  })

/**
 * The selected Posts the tab shows, in its order, at most `EXPORT_LIMIT`:
 * what Copy links and Export Markdown take (PTR-06). While ranked, the
 * Ranking's cached Posts; otherwise asked fresh, so an edit a moment ago is
 * in it.
 */
export async function fetchSelectedShown(
  queryClient: QueryClient,
  view: PostsView,
  api: RankingApi,
): Promise<Post[]> {
  const read = { kind: "selectedShown" } as const
  if (servedBy(view, read) === "ranking")
    return (await queryClient.ensureQueryData(rankingQuery(view, api))).filter(
      (post) => post.selected,
    )
  const { queryKey, queryFn } = postsQuery(view, read)
  return queryClient.fetchQuery({ queryKey, queryFn, staleTime: 0 })
}
