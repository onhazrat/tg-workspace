import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { toast } from 'sonner';
import { Post } from '../types';
import { useSettings } from './SettingsContext';
import { searchSimilarPostsFromQuery } from '../services/rag';
import { api } from "@/api";

interface RAGSearchOptions {
  channels?: string[];
  startDate?: number;
  endDate?: number;
}

interface RAGContextType {
  isSyncing: boolean;
  progress: { current: number; total: number };
  searchSimilarPosts: (query: string, limit?: number, options?: RAGSearchOptions) => Promise<Post[]>;
  forceSync: () => Promise<void>;
}

const RAGContext = createContext<RAGContextType | undefined>(undefined);

const STATUS_POLL_MS = 10_000;

export const RAGProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { embeddingsEnabled } = useSettings();
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const refreshStatus = useCallback(async () => {
    if (!embeddingsEnabled) {
      setIsSyncing(false);
      setProgress({ current: 0, total: 0 });
      return;
    }
    try {
      const status = await api.ragStatus();
      setIsSyncing(status.pending > 0);
      setProgress({
        current: Math.max(0, status.total - status.pending),
        total: status.total,
      });
    } catch (error) {
      console.error('[RAGProvider] Failed to fetch embedding status:', error);
    }
  }, [embeddingsEnabled]);

  useEffect(() => {
    if (!embeddingsEnabled) return;
    refreshStatus();
    const timer = setInterval(refreshStatus, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [embeddingsEnabled, refreshStatus]);

  const searchSimilarPosts = useCallback(async (
    query: string,
    limit: number = 10,
    options?: RAGSearchOptions
  ): Promise<Post[]> => {
    if (!embeddingsEnabled) return [];

    try {
      return await searchSimilarPostsFromQuery(
        query,
        limit,
        options?.channels,
        options?.startDate,
        options?.endDate
      );
    } catch (error) {
      console.error('[RAGProvider] Search failed:', error);
      const message = error instanceof Error ? error.message : "Semantic search failed";
      throw new Error(message);
    }
  }, [embeddingsEnabled]);

  const forceSync = useCallback(async () => {
    if (!embeddingsEnabled) return;
    try {
      await api.ragEmbed({ limit: 100 });
      await refreshStatus();
    } catch (error) {
      console.error('[RAGProvider] Server embed backfill failed:', error);
      const message = error instanceof Error ? error.message : "Embedding backfill failed";
      toast.error(message);
    }
  }, [embeddingsEnabled, refreshStatus]);

  return (
    <RAGContext.Provider
      value={{
        isSyncing,
        progress,
        searchSimilarPosts,
        forceSync,
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
