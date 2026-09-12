import { api } from "@/api"
import type { ChatSessionSubmitRequest } from "@/client"
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

/**
 * Open a chat at a frozen Scope, before any AI work starts (AW-06).
 *
 * Called once per conversation, on the turn that creates it.
 * {@link saveChatSession} appends every turn after that and cannot move the
 * boundaries the first answer was built from — which is the whole point, since
 * a conversation can outlive the Live window it started in.
 */
export const submitChatSession = (
  body: ChatSessionSubmitRequest,
): Promise<ChatSession> => api.submitChatSession(body)

export const saveChatSession = async (
  session: Partial<ChatSession>,
): Promise<void> => {
  if (!session.id) throw new Error("saveChatSession needs an id")
  await api.upsertChatSession(session.id, session)
}

export const deleteChatSession = async (id: string): Promise<void> => {
  await api.deleteChatSession(id)
}
