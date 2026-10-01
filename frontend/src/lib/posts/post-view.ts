import {
  postViewValue,
  type ViewEstimate,
  type ViewMeasure,
} from "@/lib/posts/estimated-views"
import { formatPostMediaHints } from "@/lib/posts/post-media"
import type { Post } from "@/types"

export type { ViewEstimate, ViewMeasure } from "@/lib/posts/estimated-views"

export type { MediaFilterValue } from "@/lib/posts/post-media"
export { getPostEmbeddingText } from "@/lib/posts/post-media"

/**
 * Which Posts the per-channel cap keeps (PFB-01). `ordered` is each channel's
 * first N **in the chosen order**; it was `latest`, renamed rather than
 * reinterpreted so a cap under `oldest` can never be labelled "newest".
 */
export type MaxPostsPerChannelMode = "ordered" | "random"
/**
 * The feed's order. Grouping by channel is its own switch (PFB-01); the views
 * orders read `viewMeasure` (PFB-03).
 */
export type PostSortOrder = "newest" | "oldest" | "most_views" | "fewest_views"

/**
 * At least or at most a number of views: a frozen Scope's threshold from
 * before PTR-03, read-only. A live views bound is a Post filter Condition.
 */
export interface ViewsFilter {
  op: "gte" | "lte"
  value: number
}

export interface PostViewOptions {
  maxPostsPerChannel: number
  maxPostsPerChannelMode: MaxPostsPerChannelMode
  postSortOrder: PostSortOrder
  groupByChannel: boolean
  /** What the views orders read (PFB-03). */
  viewMeasure: ViewMeasure
  /**
   * The curve and settings an Estimated View count reads through. Only the
   * browser pipeline needs it, for semantic results; absent, every estimate
   * is none.
   */
  viewEstimate?: ViewEstimate | null
}

/** A frozen Scope's Type filter from before PTR-03, read-only. */
export type ForwardedFilterValue =
  | "all"
  | "forwarded"
  | "original"
  | "unfollowed_forwarded"

export interface BuildFilteredPostsContext {
  searchText: string
  view: PostViewOptions
  startDate: number
  endDate: number
}

function hashString(value: string): number {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const copy = [...items]
  const random = mulberry32(seed)
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function buildRandomSeed(
  channelName: string,
  limit: number,
  seedContext: { startDate: number; endDate: number },
  sortedChannelNames: string[],
): number {
  return hashString(
    `${channelName}:${seedContext.startDate}:${seedContext.endDate}:${limit}:${sortedChannelNames.join(",")}`,
  )
}

function groupPostsByChannel(posts: Post[]): Map<string, Post[]> {
  const groups = new Map<string, Post[]>()
  for (const post of posts) {
    const existing = groups.get(post.channelName)
    if (existing) {
      existing.push(post)
    } else {
      groups.set(post.channelName, [post])
    }
  }
  return groups
}

export function applyKeywordFilter(posts: Post[], searchText: string): Post[] {
  if (!searchText.trim()) return posts
  const query = searchText.toLowerCase()
  return posts.filter(
    (post) =>
      post.text.toLowerCase().includes(query) ||
      post.channelName.toLowerCase().includes(query),
  )
}

export function applyMaxPostsPerChannel(
  posts: Post[],
  view: PostViewOptions,
  seedContext?: { startDate: number; endDate: number },
): Post[] {
  const limit = view.maxPostsPerChannel
  if (limit <= 0) return posts

  const groups = groupPostsByChannel(posts)
  const sortedChannelNames = [...groups.keys()].sort((a, b) =>
    a.localeCompare(b),
  )
  const capped: Post[] = []

  for (const channelName of sortedChannelNames) {
    const channelPosts = groups.get(channelName) ?? []
    if (channelPosts.length <= limit) {
      capped.push(...channelPosts)
      continue
    }

    if (view.maxPostsPerChannelMode === "ordered") {
      const sorted = [...channelPosts].sort(byOrder(view))
      capped.push(...sorted.slice(0, limit))
      continue
    }

    const seed = buildRandomSeed(
      channelName,
      limit,
      seedContext ?? { startDate: 0, endDate: 0 },
      sortedChannelNames,
    )
    capped.push(...seededShuffle(channelPosts, seed).slice(0, limit))
  }

  return capped
}

const byTime =
  (dir: number) =>
  (a: Post, b: Post): number =>
    (a.timestamp - b.timestamp) * dir ||
    a.channelName.localeCompare(b.channelName) ||
    (a.id - b.id) * dir

/**
 * The chosen order: the timestamp, newest or oldest first, then the channel
 * name, then the post id running the same way as the timestamp. The views
 * orders put the value first, a Post with none last either way, then newest
 * first (PFB-03). Also what the `ordered` cap keeps the first N of. Mirrors
 * `channel_order` and `_feed_order_by` in backend/app/services/posts.py,
 * tiebreak included, so a semantic result reads in the order the server feed
 * would give it.
 */
function byOrder(view: PostViewOptions): (a: Post, b: Post) => number {
  const order = view.postSortOrder
  if (order === "newest" || order === "oldest")
    return byTime(order === "oldest" ? 1 : -1)
  const dir = order === "most_views" ? -1 : 1
  const value = (post: Post) =>
    postViewValue(post, view.viewMeasure, view.viewEstimate)
  const newest = byTime(-1)
  return (a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va == null || vb == null)
      return (va == null ? 1 : 0) - (vb == null ? 1 : 0) || newest(a, b)
    return (va - vb) * dir || newest(a, b)
  }
}

/**
 * Each channel's best key under the order, as the server places a grouped
 * block by: the timestamp, or the value with none last. Compares only that
 * key, so a tie falls to the channel name as it does in `_feed_order_by`.
 */
function byBlockKey(view: PostViewOptions): (a: Post, b: Post) => number {
  const order = view.postSortOrder
  if (order === "newest" || order === "oldest") {
    const dir = order === "oldest" ? 1 : -1
    return (a, b) => (a.timestamp - b.timestamp) * dir
  }
  const dir = order === "most_views" ? -1 : 1
  return (a, b) => {
    const va = postViewValue(a, view.viewMeasure, view.viewEstimate)
    const vb = postViewValue(b, view.viewMeasure, view.viewEstimate)
    if (va == null || vb == null)
      return (va == null ? 1 : 0) - (vb == null ? 1 : 0)
    return (va - vb) * dir
  }
}

export function sortPosts(posts: Post[], view: PostViewOptions): Post[] {
  const sorted = [...posts].sort(byOrder(view))
  if (!view.groupByChannel) return sorted

  // Each channel's block sits where its first Post falls under the order, and
  // the order holds inside the block (PFB-02). A block's first Post is its
  // best, so blocks sort by that Post's key and then by channel name, the
  // server's tiebreak between two blocks.
  const blockKey = byBlockKey(view)
  return [...groupPostsByChannel(sorted).entries()]
    .sort(
      ([nameA, [firstA]], [nameB, [firstB]]) =>
        blockKey(firstA, firstB) || nameA.localeCompare(nameB),
    )
    .flatMap(([, block]) => block)
}

/** Whether the order reads an Estimated View count: a views order does. */
export function readsEstimatedViews(view: PostViewOptions): boolean {
  return (
    view.viewMeasure === "estimated" &&
    (view.postSortOrder === "most_views" ||
      view.postSortOrder === "fewest_views")
  )
}

export function applyPostViewPipeline(
  posts: Post[],
  view: PostViewOptions,
  seedContext?: { startDate: number; endDate: number },
): Post[] {
  const capped = applyMaxPostsPerChannel(posts, view, seedContext)
  return sortPosts(capped, view)
}

export function formatPostsForPrompt(posts: Post[]): string {
  return posts
    .map((post) => {
      const mediaHints = formatPostMediaHints(post)
      const lines = [
        `[${post.channelName}] ID: ${post.id}`,
        `Date: ${post.date}`,
      ]
      if (mediaHints) lines.push(mediaHints)
      lines.push(`Content: ${post.text}`)
      return lines.join("\n")
    })
    .join("\n\n---\n\n")
}

/**
 * The keyword, the cap and the order over Posts already in the browser, for a
 * meaning search's ranked results. The Post filter is not here: only the
 * server evaluates it (PTR-03), through the lookup.
 */
export function buildFilteredPostsFromRaw(
  posts: Post[],
  ctx: BuildFilteredPostsContext,
): Post[] {
  const filtered = applyKeywordFilter(posts, ctx.searchText)
  return applyPostViewPipeline(filtered, ctx.view, {
    startDate: ctx.startDate,
    endDate: ctx.endDate,
  })
}
