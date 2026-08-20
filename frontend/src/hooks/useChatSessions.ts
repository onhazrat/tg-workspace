import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { getChatSession, listChatSessions } from "@/lib/chat-sessions/store"
import type { ChatSessionListItem } from "@/types"

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"

const EMPTY: ChatSessionListItem[] = []

/** Metadata-only list. Use `useChatSessionQuery` for the transcript. */
export function useChatSessionsQuery() {
  return useQuery({
    queryKey: queryKeys.chatSessions,
    queryFn: async () => {
      const sessions = await listChatSessions()
      return [...sessions].sort((a, b) => b.timestamp - a.timestamp)
    },
    staleTime: SUMMARIZER_STALE_TIME,
    refetchOnWindowFocus: true,
  })
}

export function useChatSessionsList(): ChatSessionListItem[] {
  return useChatSessionsQuery().data ?? EMPTY
}

export function useChatSessionQuery(id: string | null) {
  return useQuery({
    queryKey: queryKeys.chatSession(id ?? ""),
    queryFn: () => getChatSession(id as string),
    enabled: Boolean(id),
    staleTime: SUMMARIZER_STALE_TIME,
  })
}

export function useInvalidateChatSessions() {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.chatSessions })
    // The unified History list reads chat sessions too.
    await queryClient.invalidateQueries({ queryKey: ["artifacts"] })
  }, [queryClient])
}
