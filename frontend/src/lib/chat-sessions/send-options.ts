import type { ChatMessage } from "@/types"

/** What a caller may override when sending a chat turn. */
export interface SendOptions {
  /** The message to send, instead of whatever is in the composer. */
  message?: string
  /** The turns to send it after. `[]` starts a conversation. */
  history?: ChatMessage[]
  /** The session to append to. `null` mints a new one. */
  sessionId?: string | null
}

export interface LiveChatState {
  chatInput: string
  chatMessages: ChatMessage[]
  sessionId: string | null
}

export type ResolvedSend = Required<Omit<SendOptions, "sessionId">> & {
  sessionId: string | null
}

/**
 * Decide what a send actually sends.
 *
 * The Action tab starts a conversation from outside the composer, so the three
 * inputs a send needs can each come from a caller or from live state. Two of
 * them have a meaningful "empty" — `null` for the session and `[]` for the
 * history — and `??` cannot tell an explicit empty from an omission. It would
 * fall back to the live values, which is precisely how a new chat ends up
 * writing its first turn over the last chat's transcript: the session payload
 * replaces `messages` wholesale.
 *
 * A presence check can tell them apart, so this uses one. Naming the key at
 * all is the statement: `{ sessionId: undefined }` reads as "I am telling you
 * which session, and there isn't one", not as an omission.
 */
export function resolveSend(
  options: SendOptions | undefined,
  live: LiveChatState,
): ResolvedSend {
  return {
    message: (options?.message ?? live.chatInput).trim(),
    history: options?.history ?? live.chatMessages,
    sessionId:
      options && "sessionId" in options
        ? (options.sessionId ?? null)
        : live.sessionId,
  }
}
