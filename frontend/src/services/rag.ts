import { PostEmbedding } from '../types';
import { api } from '../api/client';
import { getPost } from '../lib/db';

/**
 * Server-side RAG search (Phase 5). Falls back to empty when server unavailable.
 */
export async function searchSimilarEmbeddings(
  queryVector: number[],
  limit: number = 10,
  options?: {
    channels?: string[];
    startDate?: number;
    endDate?: number;
    queryText?: string;
  }
): Promise<PostEmbedding[]> {
  if (options?.queryText) {
    try {
      const result = await api.ragSearch({
        query: options.queryText,
        channels: options.channels,
        startDate: options.startDate,
        endDate: options.endDate,
        limit,
      }) as { results: Array<{ channelName: string; postId: number; text: string; score: number }> };
      return result.results.map((r) => ({
        id: `${r.channelName}_${r.postId}`,
        channelName: r.channelName,
        postId: r.postId,
        vector: queryVector,
        text: r.text,
      }));
    } catch {
      /* fall through to local */
    }
  }
  return [];
}

export async function searchSimilarPostsFromQuery(
  query: string,
  limit: number = 10,
  channels?: string[],
  startDate?: number,
  endDate?: number
) {
  const result = await api.ragSearch({
    query,
    channels,
    startDate,
    endDate,
    limit,
  }) as { results: Array<{ channelName: string; postId: number }> };
  const posts = [];
  for (const r of result.results) {
    const post = await getPost(r.channelName, r.postId);
    if (post) posts.push(post);
  }
  return posts;
}
