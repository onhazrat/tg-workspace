/**
 * The rules one chat turn follows, with no React and no I/O, so they can be
 * tested directly. `ChatContext` is the only caller; it keeps the streaming,
 * the saving and the state.
 */
import { withMissingPosts } from "@/lib/artifacts/artifact-run"
import type { ChatMessage, ChatMode, ChatSession, LLMLog, Post } from "@/types"

export const NO_CONTEXT_REPLY =
  "I couldn't find any relevant information in your history to answer that question. Please ensure your posts have been synced and processed."

/**
 * Replace the model's turn at the end of the transcript, or start one.
 *
 * The turns are written *after* the session is opened, so a submission that
 * fails — offline, a 4xx, a refused Scope — reports its error with none on
 * screen at all. Overwriting `length - 1` then wrote index `-1`: a property,
 * not an element, so the failure was invisible and the Chat tab sat empty with
 * the question already cleared from Action. `slice(0, -1)` of an empty list is
 * empty, so this starts the transcript instead.
 */
export function replaceLastTurn(
  messages: ChatMessage[],
  turn: ChatMessage,
): ChatMessage[] {
  return [...messages.slice(0, -1), turn]
}

export const chatErrorText = (err: unknown): string =>
  `Error: ${err instanceof Error ? err.message : "Failed to generate response"}`

/** What one answered turn produced, whichever mode produced it. */
export interface TurnResult {
  text: string
  /** The last streamed chunk; carries the provider's usage metadata. */
  lastChunk: unknown
  /** Empty when the model was never asked (a semantic search that found nothing). */
  prompt: string
  config: unknown
  systemInstruction: string
  /** Semantic mode only: the posts the answer was grounded in. */
  sources?: Post[]
  /**
   * Semantic mode only: how many Posts it ranked. A turn over the Chat's
   * Covered Posts leaves the count the Chat recorded at submission.
   */
  postCount?: number
  /** Covered Posts this turn's prompt left out (ADR-038). */
  missingPosts?: number
}

/** The answer's turn as the transcript keeps it. */
export const answerTurn = (turn: TurnResult): ChatMessage => ({
  role: "model",
  text: turn.text,
  sources: turn.sources,
  ...withMissingPosts(turn.missingPosts ?? 0),
})

function totalTokens(chunk: unknown): number | undefined {
  const usage = (chunk as { usageMetadata?: { totalTokenCount?: number } })
    ?.usageMetadata
  return usage?.totalTokenCount
}

/** The LLM log for a turn, or null when the model was never asked. */
export function chatLLMLog(
  turn: TurnResult,
  ctx: {
    id: string
    model: string
    mode: ChatMode
    message: string
    history: ChatMessage[]
    now: number
    durationMs: number
  },
): LLMLog | null {
  if (!turn.prompt) return null
  return {
    id: ctx.id,
    model: ctx.model,
    prompt: ctx.message, // For chat, the prompt is the user message
    response: turn.text,
    systemInstruction: turn.systemInstruction,
    modelConfig: turn.config,
    fullRequest: {
      message: ctx.message,
      history: ctx.history,
      config: turn.config,
    },
    fullResponse: turn.lastChunk,
    tokens: totalTokens(turn.lastChunk),
    status: turn.text ? "success" : "failed",
    timestamp: ctx.now,
    duration: ctx.durationMs,
    type: ctx.mode === "semantic" ? "chat_semantic" : "chat_full_scope",
  }
}

/**
 * The session write after a turn: what the turn produced, and nothing the
 * submission already settled (AW-06). The channels and window are the frozen
 * Scope, which the server owns.
 */
export function chatSessionRecord(
  sessionId: string,
  history: ChatMessage[],
  message: string,
  turn: TurnResult,
  now: number,
): Partial<ChatSession> {
  return {
    id: sessionId,
    ...(turn.postCount === undefined ? {} : { postCount: turn.postCount }),
    timestamp: now,
    messages: [...history, { role: "user", text: message }, answerTurn(turn)],
  }
}

/**
 * What the transcript loader does when the open chat or its query changes.
 *
 * `null` is "leave everything alone": the transcript is already loaded, or has
 * not arrived yet. An empty Chat tab clears whatever a filled one had loaded,
 * but not the turns of a first message streaming into it. Otherwise it loads
 * the opened session's transcript once, so a live conversation's own turns are
 * never overwritten by a refetch.
 */
export function transcriptLoad(
  sessionId: string | null,
  loadedId: string | null,
  session: { messages?: ChatMessage[] | null } | undefined,
): { loadedId: string | null; messages?: ChatMessage[] } | null {
  if (!sessionId) {
    return loadedId ? { loadedId: null, messages: [] } : { loadedId: null }
  }
  if (loadedId === sessionId || !session) return null
  return { loadedId: sessionId, messages: session.messages ?? [] }
}
