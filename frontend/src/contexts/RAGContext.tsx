import type React from "react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { env } from "@/lib/env"
import { searchSimilarPostsFromQuery } from "../services/rag"
import type { Post } from "../types"
import { useSettings } from "./SettingsContext"

interface RAGSearchOptions {
  channels?: string[]
  startDate?: number
  endDate?: number
}

interface RAGContextType {
  isSyncing: boolean
  progress: { current: number; total: number }
  searchSimilarPosts: (
    query: string,
    limit?: number,
    options?: RAGSearchOptions,
  ) => Promise<Post[]>
  forceSync: () => Promise<void>
}

const RAGContext = createContext<RAGContextType | undefined>(undefined)

export const RAGProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { embeddingsEnabled } = useSettings()
  const [isSyncing, setIsSyncing] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const refreshStatus = useCallback(async () => {
    if (!embeddingsEnabled) {
      setIsSyncing(false)
      setProgress({ current: 0, total: 0 })
      return
    }
    try {
      const status = await api.ragStatus()
      // Every field on `RagStatusResponse` has a server-side default, so all
      // three are always on the wire — but a defaulted Pydantic field is
      // `optional` in OpenAPI, so the generated type cannot say so.
      const pending = status.pending ?? 0
      const total = status.total ?? 0
      setIsSyncing(pending > 0)
      setProgress({ current: Math.max(0, total - pending), total })
    } catch (error) {
      console.error("[RAGProvider] Failed to fetch embedding status:", error)
    }
  }, [embeddingsEnabled])

  useEffect(() => {
    if (!embeddingsEnabled) return
    refreshStatus()
    const timer = setInterval(refreshStatus, env.ragStatusPollMs)
    return () => clearInterval(timer)
  }, [embeddingsEnabled, refreshStatus])

  const searchSimilarPosts = useCallback(
    async (
      query: string,
      limit: number = 10,
      options?: RAGSearchOptions,
    ): Promise<Post[]> => {
      if (!embeddingsEnabled) return []

      try {
        return await searchSimilarPostsFromQuery(
          query,
          limit,
          options?.channels,
          options?.startDate,
          options?.endDate,
        )
      } catch (error) {
        console.error("[RAGProvider] Search failed:", error)
        const message =
          error instanceof Error ? error.message : "Semantic search failed"
        throw new Error(message)
      }
    },
    [embeddingsEnabled],
  )

  const forceSync = useCallback(async () => {
    if (!embeddingsEnabled) return
    try {
      await api.ragEmbed({ limit: 100 })
      await refreshStatus()
    } catch (error) {
      console.error("[RAGProvider] Server embed backfill failed:", error)
      const message =
        error instanceof Error ? error.message : "Embedding backfill failed"
      toast.error(message)
    }
  }, [embeddingsEnabled, refreshStatus])

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
  )
}

export function useRAG() {
  const context = useContext(RAGContext)
  if (context === undefined) {
    throw new Error("useRAG must be used within a RAGProvider")
  }
  return context
}
