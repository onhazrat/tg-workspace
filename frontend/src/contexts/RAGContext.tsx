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
import { errorText } from "@/lib/artifacts/artifact-run"
import { env } from "@/lib/env"
import { embeddingProgress, searchSimilarPostsFromQuery } from "../services/rag"
import type { Post } from "../types"
import { useSettings } from "./SettingsContext"

/**
 * Channels are optional; the Analysis window is not (AW-01).
 *
 * Both bounds used to be optional and two of the three call sites omitted
 * them, which is how semantic retrieval and "more like this" searched all
 * time while the rest of Scope meant a window. Required here so a caller that
 * forgets does not compile, and required on the server so one that is not
 * this client gets a 422 rather than a different answer.
 */
interface RAGSearchOptions {
  channels?: string[]
  startDate: number
  endDate: number
}

interface RAGContextType {
  isSyncing: boolean
  progress: { current: number; total: number }
  searchSimilarPosts: (
    query: string,
    limit: number,
    options: RAGSearchOptions,
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
      const next = embeddingProgress(await api.ragStatus())
      setIsSyncing(next.isSyncing)
      setProgress(next.progress)
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
      options: RAGSearchOptions,
    ): Promise<Post[]> => {
      if (!embeddingsEnabled) return []

      try {
        return await searchSimilarPostsFromQuery(
          query,
          limit,
          options.channels,
          options.startDate,
          options.endDate,
        )
      } catch (error) {
        console.error("[RAGProvider] Search failed:", error)
        throw new Error(errorText(error, "Semantic search failed"))
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
      toast.error(errorText(error, "Embedding backfill failed"))
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
