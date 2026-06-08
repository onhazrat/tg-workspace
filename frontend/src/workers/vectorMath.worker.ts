import { PostEmbedding } from '../types';
import { getAllEmbeddings } from '../lib/db';

// Calculate cosine similarity between two vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  // Assuming vectors are of the same length
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type, queryVector, limit } = e.data;

  if (type === 'SEARCH') {
    try {
      // Fetch embeddings directly from DB to avoid passing large arrays via postMessage
      const embeddings = await getAllEmbeddings();

      // Score all embeddings
      const scored = embeddings.map((emb: PostEmbedding) => ({
        embedding: emb,
        score: cosineSimilarity(queryVector, emb.vector)
      }));

      // Sort descending by score
      scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);

      // Take top K
      const topK = scored.slice(0, limit).map((s: { embedding: PostEmbedding }) => s.embedding);

      self.postMessage({ id, success: true, results: topK });
    } catch (error: any) {
      self.postMessage({ id, success: false, error: error.message });
    }
  }
};
