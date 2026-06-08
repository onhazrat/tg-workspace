import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Post, PostEmbedding } from '../types';
import { useSettings } from './SettingsContext';
import { getPostsWithoutEmbeddings, saveEmbeddings, getAllEmbeddings, getPost } from '../lib/db';
import { generateEmbeddings } from '../services/ai';
import { searchSimilarEmbeddings } from '../services/rag';
import { toast } from 'sonner';

interface RAGContextType {
  isSyncing: boolean;
  progress: { current: number; total: number };
  searchSimilarPosts: (query: string, limit?: number) => Promise<Post[]>;
  forceSync: () => Promise<void>;
}

const RAGContext = createContext<RAGContextType | undefined>(undefined);

export const RAGProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { embeddingsEnabled, embeddingsPaused, setEmbeddingsPaused } = useSettings();
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const syncEmbeddings = useCallback(async () => {
    if (isSyncing || !embeddingsEnabled || embeddingsPaused) return;
    
    try {
      setIsSyncing(true);
      
      const postsToProcess = await getPostsWithoutEmbeddings(100);
      if (postsToProcess.length === 0) {
        setIsSyncing(false);
        return;
      }

      setProgress({ current: 0, total: postsToProcess.length });

      const chunkSize = 20;
      for (let i = 0; i < postsToProcess.length; i += chunkSize) {
        const chunk = postsToProcess.slice(i, i + chunkSize);
        const texts = chunk.map(p => p.text || p.channelName);
        
        try {
          const vectors = await generateEmbeddings(texts);
          
          const newEmbeddings: PostEmbedding[] = chunk.map((post, index) => ({
            id: `${post.channelName}_${post.id}`,
            channelName: post.channelName,
            postId: post.id,
            vector: vectors[index],
            text: post.text || post.channelName
          }));
          
          await saveEmbeddings(newEmbeddings);
          setProgress(prev => ({ ...prev, current: prev.current + chunk.length }));
        } catch (error: any) {
          console.error("[RAGProvider] Failed to generate embeddings for chunk:", error);
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (errorMsg.toLowerCase().includes("quota") || errorMsg.toLowerCase().includes("429")) {
            setEmbeddingsPaused(true);
            toast.error("Embeddings sync paused due to API Quota Exceeded.");
          }
          break;
        }
      }
    } catch (error) {
      console.error("[RAGProvider] Error in embedding sync:", error);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, embeddingsEnabled, embeddingsPaused]);

  // Initial embedding sync on mount; ongoing sync handled by server APScheduler (Phase 4)
  useEffect(() => {
    if (!embeddingsEnabled || embeddingsPaused) return;
    const timer = setTimeout(syncEmbeddings, 5000);
    return () => clearTimeout(timer);
  }, [syncEmbeddings, embeddingsEnabled, embeddingsPaused]);

  const searchSimilarPosts = useCallback(async (query: string, limit: number = 10): Promise<Post[]> => {
    if (!embeddingsEnabled) return [];

    try {
      const [queryVector] = await generateEmbeddings([query]);
      if (!queryVector) return [];

      const topEmbeddings = await searchSimilarEmbeddings(queryVector, limit, { queryText: query });
      
      // Fetch the actual posts
      const posts: Post[] = [];
      for (const emb of topEmbeddings) {
        const post = await getPost(emb.channelName, emb.postId);
        if (post) {
          posts.push(post);
        }
      }
      
      return posts;
    } catch (error) {
      console.error("[RAGProvider] Search failed:", error);
      return [];
    }
  }, [embeddingsEnabled]);

  return (
    <RAGContext.Provider
      value={{
        isSyncing,
        progress,
        searchSimilarPosts,
        forceSync: syncEmbeddings
      }}
    >
      {children}
    </RAGContext.Provider>
  );
};

export function useRAG() {
  const context = useContext(RAGContext);
  if (context === undefined) {
    throw new Error('useRAG must be used within a RAGProvider');
  }
  return context;
}
