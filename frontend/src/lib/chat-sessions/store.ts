import { api } from "@/api"
import type { ChatSession, ChatSessionListItem } from "@/types"

/**
 * Transport wrappers for chat sessions.
 *
 * Mirrors `lib/summaries/store.ts`, including its rule: **these do not
 * invalidate the query cache.** Callers invalidate explicitly, because a chat
 * writes after every turn and refetching the whole history list mid-conversation
 * is the kind of thing that makes a fast chat feel slow.
 */

/** List projection — metadata and a count, never the transcript. */
export const listChatSessions = (params?: {
  search?: string
  limit?: number
  offset?: number
}): Promise<ChatSessionListItem[]> => api.listChatSessions(params)

/** One session in full, transcript included. */
export const getChatSession = (id: string): Promise<ChatSession> =>
  api.getChatSession(id)

export const saveChatSession = async (
  session: Partial<ChatSession>,
): Promise<void> => {
  if (!session.id) throw new Error("saveChatSession needs an id")
  await api.upsertChatSession(session.id, session)
}

export const deleteChatSession = async (id: string): Promise<void> => {
  await api.deleteChatSession(id)
}
