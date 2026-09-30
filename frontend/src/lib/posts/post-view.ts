import {
  formatPostMediaHints,
  type MediaFilterValue,
  matchesMediaFilter,
} from "@/lib/posts/post-media"
import type { Channel, Post } from "@/types"

export type { MediaFilterValue } from "@/lib/posts/post-media"
export { getPostEmbeddingText } from "@/lib/posts/post-media"

/**
 * Which Posts the per-channel cap keeps (PFB-01). `ordered` is each channel's
 * first N **in the chosen order**; it was `latest`, renamed rather than
 * reinterpreted so a cap under `oldest` can never be labelled "newest".
 */
export type MaxPostsPerChannelMode = "ordered" | "random"
/** The feed's order. Grouping by channel is its own switch (PFB-01). */
export type PostSortOrder = "newest" | "oldest"

export interface PostViewOptions {
  maxPostsPerChannel: number
  maxPostsPerChannelMode: MaxPostsPerChannelMode
  postSortOrder: PostSortOrder
  groupByChannel: boolean
}

export type ForwardedFilterValue =
  | "all"
  | "forwarded"
  | "original"
  | "unfollowed_forwarded"

export interface BuildFilteredPostsContext {
  searchText: string
  forwardedFilter: ForwardedFilterValue
  mediaFilter: MediaFilterValue
  /** The Post's own Language, any of these; empty for any (PFB-02). */
  languageFilter: string[]
  channels: Channel[]
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

export function applyForwardedFilter(
  posts: Post[],
  forwardedFilter: ForwardedFilterValue,
  channels: Channel[],
): Post[] {
  if (forwardedFilter === "all") return posts

  if (forwardedFilter === "forwarded") {
    return posts.filter((p) => !!p.forwardedFrom)
  }

  if (forwardedFilter === "original") {
    return posts.filter((p) => !p.forwardedFrom)
  }

  return posts.filter(
    (p) =>
      p.forwardedFrom &&
      !channels.some(
        (c) => c.name.toLowerCase() === p.forwardedFrom?.toLowerCase(),
      ),
  )
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
      const sorted = [...channelPosts].sort(byOrder(view.postSortOrder))
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

/**
 * The chosen order: the timestamp, newest or oldest first, then the channel
 * name, then the post id running the same way as the timestamp. Also what the
 * `ordered` cap keeps the first N of. Mirrors `channel_time_order` and
 * `_feed_order_by` in backend/app/services/posts.py, tiebreak included, so a
 * semantic result reads in the order the server feed would give it.
 */
function byOrder(order: PostSortOrder): (a: Post, b: Post) => number {
  const dir = order === "oldest" ? 1 : -1
  return (a, b) =>
    (a.timestamp - b.timestamp) * dir ||
    a.channelName.localeCompare(b.channelName) ||
    (a.id - b.id) * dir
}

export function sortPosts(posts: Post[], view: PostViewOptions): Post[] {
  const compare = byOrder(view.postSortOrder)
  const sorted = [...posts].sort(compare)
  if (!view.groupByChannel) return sorted

  // Each channel's block sits where its first Post falls under the order, and
  // the order holds inside the block (PFB-02). `Map` keeps insertion order, so
  // grouping the already-sorted list is exactly that: a block is placed by its
  // best key, a tie between blocks broken by the channel name as `compare`
  // already broke it.
  return [...groupPostsByChannel(sorted).values()].flat()
}

export function applyPostViewPipeline(
  posts: Post[],
  view: PostViewOptions,
  seedContext?: { startDate: number; endDate: number },
): Post[] {
  const capped = applyMaxPostsPerChannel(posts, view, seedContext)
  return sortPosts(capped, view)
}

export function applyLanguageFilter(
  posts: Post[],
  languageFilter: string[],
): Post[] {
  if (languageFilter.length === 0) return posts
  const ticked = new Set(languageFilter)
  // An unread Post (`language` null) has no Language to be ticked.
  return posts.filter(
    (post) => post.language != null && ticked.has(post.language),
  )
}

export function applyMediaFilter(
  posts: Post[],
  mediaFilter: MediaFilterValue,
): Post[] {
  if (mediaFilter.length === 0) return posts
  return posts.filter((post) => matchesMediaFilter(post, mediaFilter))
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

export function buildFilteredPostsFromRaw(
  posts: Post[],
  ctx: BuildFilteredPostsContext,
): Post[] {
  let filtered = applyKeywordFilter(posts, ctx.searchText)
  filtered = applyForwardedFilter(filtered, ctx.forwardedFilter, ctx.channels)
  filtered = applyMediaFilter(filtered, ctx.mediaFilter)
  filtered = applyLanguageFilter(filtered, ctx.languageFilter)
  return applyPostViewPipeline(filtered, ctx.view, {
    startDate: ctx.startDate,
    endDate: ctx.endDate,
  })
}
