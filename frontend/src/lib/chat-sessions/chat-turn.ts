/**
 * The rules one chat turn follows, with no React and no I/O, so they can be
 * tested directly. `ChatContext.handleSendMessage` is the only caller; it keeps
 * the streaming, the saving and the state.
 */
import type {
  Channel,
  ChatMessage,
  ChatMode,
  ChatSession,
  LLMLog,
  Post,
} from "@/types"

export const NO_CONTEXT_REPLY =
  "I couldn't find any relevant information in your history to answer that question. Please ensure your posts have been synced and processed."

/** A channel synced within this long of the window's end counts as current. */
const SYNC_SLACK_MS = 60_000

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

/** Selected channels whose last sync is older than a minute before the window ends (or now, if sooner). */
export function channelsToSyncBeforeChat(
  channels: Channel[],
  selected: ReadonlySet<string>,
  windowEnd: number,
  now: number,
): Channel[] {
  const target = Math.min(windowEnd, now) - SYNC_SLACK_MS
  return channels.filter(
    (c) => selected.has(c.name) && (!c.lastUpdated || c.lastUpdated < target),
  )
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
  postCount: number
}

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
    postCount: turn.postCount,
    timestamp: now,
    messages: [
      ...history,
      { role: "user", text: message },
      { role: "model", text: turn.text, sources: turn.sources },
    ],
  }
}
