import { api } from "@/api"
import { lookupPosts } from "@/lib/posts/store"
import type { Post } from "../types"

export interface RagSearchResult {
  score: number
  channelName: string
  postId: number
  text: string
  post: Post | null
}

/**
 * Server-side RAG search (Phase 5). Hydrates posts from response or repository cache.
 *
 * Embedding text should use enriched media hints — see getPostEmbeddingText in
 * @/lib/posts/post-media (server backfill should mirror the same formatting).
 */
export { getPostEmbeddingText } from "@/lib/posts/post-media"
export async function searchSimilarPostsFromQuery(
  query: string,
  limit: number = 10,
  channels?: string[],
  startDate?: number,
  endDate?: number,
): Promise<Post[]> {
  const result = (await api.ragSearch({
    query,
    channels,
    startDate,
    endDate,
    limit,
  })) as { results: RagSearchResult[] }

  return resolveRagPosts(result.results, lookupPosts)
}

/**
 * Turn search hits into posts, resolving any the server did not inline.
 *
 * The misses are collected and fetched in one batched request. This used to
 * be a per-result `getPost`, and each of those fetched the containing
 * channel's entire history to pick out a single row.
 */
export async function resolveRagPosts(
  results: RagSearchResult[],
  lookup: (
    refs: { channelName: string; postId: number }[],
  ) => Promise<Post[]> = lookupPosts,
): Promise<Post[]> {
  const missing = results.filter((r) => !r.post)
  const fetched =
    missing.length > 0
      ? await lookup(
          missing.map((r) => ({
            channelName: r.channelName,
            postId: r.postId,
          })),
        )
      : []

  const byKey = new Map(fetched.map((p) => [`${p.channelName}#${p.id}`, p]))

  const posts: Post[] = []
  for (const r of results) {
    if (r.post) {
      posts.push(r.post)
      continue
    }
    const resolved = byKey.get(`${r.channelName}#${r.postId}`)
    if (resolved) posts.push(resolved)
  }
  return posts
}
