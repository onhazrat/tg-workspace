import { api } from "@/api"
import { getPost } from "../lib/repository"
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
 */
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

  const posts: Post[] = []
  for (const r of result.results) {
    if (r.post) {
      posts.push(r.post)
      continue
    }
    const post = await getPost(r.channelName, r.postId)
    if (post) posts.push(post)
  }
  return posts
}
