import { api } from "@/api"
import type { ArtifactPrompt } from "@/api/ai"
import type { OnFrame } from "@/api/base"
import type { TagRequest } from "@/client"
import { saveEmbeddingLog } from "@/lib/logs/write"
import type { EmbeddingLog } from "../types"

export class AIServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AIServiceError"
  }
}

export interface LLMStreamResult {
  stream: AsyncGenerator<{ text: string }, void, unknown>
  prompt: string
  config: { temperature: number }
  systemInstruction?: string
  /**
   * Covered Posts the prompt left out (ADR-038). The stream's first frame
   * says, so read it once the stream has started; 0 until then.
   */
  missingPosts: () => number
}

/** Remember the Missing Post count a stream's first frame carries. */
function missingPostsFrame(): { onFrame: OnFrame; read: () => number } {
  let missing = 0
  return {
    onFrame: (frame) => {
      if (typeof frame.missingPosts === "number") missing = frame.missingPosts
    },
    read: () => missing,
  }
}

async function* wrapStream(
  gen: AsyncGenerator<string, void, unknown>,
): AsyncGenerator<{ text: string }, void, unknown> {
  for await (const text of gen) {
    yield { text }
  }
}

/**
 * The prompt the server builds from a Summary's Covered Posts (ADR-038), its
 * Channels described by the Account's bio and tags setting (AC-03).
 */
export const getSummaryPrompt = (summaryId: string): Promise<ArtifactPrompt> =>
  api.summaryPrompt({ summaryId })

export const translateText = async (
  text: string,
  targetLanguage: string,
  model: string,
): Promise<string> => {
  const result = await api.translateBatch(
    [{ id: "1", text }],
    targetLanguage,
    model,
  )
  return result.translations[0]?.translation || text
}

export const generateEmbeddings = async (
  texts: string[],
): Promise<number[][]> => {
  const startTime = Date.now()
  let status: "success" | "failed" = "success"
  let errorMessage: string | undefined

  try {
    const result = await api.embeddings(texts)
    return result.vectors
  } catch (error: unknown) {
    status = "failed"
    errorMessage =
      error instanceof Error ? error.message : "Failed to generate embeddings"
    throw new AIServiceError(errorMessage)
  } finally {
    const duration = Date.now() - startTime
    const logEntry: EmbeddingLog = {
      id: crypto.randomUUID(),
      textCount: texts.length,
      duration,
      status,
      error: errorMessage,
      timestamp: Date.now(),
    }
    saveEmbeddingLog(logEntry).catch((e) =>
      console.error("Failed to save embedding log:", e),
    )
  }
}

/**
 * A Chat turn over the Chat's own Covered Posts: the server reads what the
 * Chat froze, so the browser names it and sends no Posts (ADR-038).
 */
export const generateChatStream = async (
  chatId: string,
  language: string,
  model: string,
  history: { role: "user" | "model"; text: string }[],
  userMessage: string,
  temperature: number = 0.7,
): Promise<LLMStreamResult> => {
  try {
    const missing = missingPostsFrame()
    const stream = api.chatStream(
      {
        chatId,
        language,
        model,
        history,
        message: userMessage,
        temperature,
        ragMode: false,
      },
      missing.onFrame,
    )
    return {
      stream: wrapStream(stream),
      prompt: userMessage,
      config: { temperature },
      missingPosts: missing.read,
    }
  } catch (error: unknown) {
    throw new AIServiceError(
      error instanceof Error ? error.message : "Failed to generate chat stream",
    )
  }
}

/** A semantic Chat turn: the Posts a meaning search ranked travel with it. */
export const chatWithHistoryStream = async (
  chatId: string,
  contextPosts: {
    text: string
    channelName: string
    date: string
    id: number
  }[],
  language: string,
  model: string,
  history: { role: "user" | "model"; text: string }[],
  userMessage: string,
  temperature: number = 0.7,
): Promise<LLMStreamResult> => {
  const postsText = contextPosts
    .map(
      (p) =>
        `[${p.channelName}] ID: ${p.id}\nDate: ${new Date(p.date).toLocaleString()}\nContent: ${p.text}`,
    )
    .join("\n\n---\n\n")

  try {
    const stream = api.chatStream({
      chatId,
      postsText,
      language,
      model,
      history,
      message: userMessage,
      temperature,
      ragMode: true,
    })
    return {
      stream: wrapStream(stream),
      prompt: userMessage,
      config: { temperature },
      // The ranked Posts travel with the turn, so none can go missing.
      missingPosts: () => 0,
    }
  } catch (error: unknown) {
    throw new AIServiceError(
      error instanceof Error
        ? error.message
        : "Failed to generate history chat stream",
    )
  }
}

export const translateTextBatch = async (
  posts: { id: string; text: string }[],
  targetLanguage: string,
  model: string,
): Promise<{ id: string; translation: string }[]> => {
  if (!posts || posts.length === 0) return []
  const result = await api.translateBatch(posts, targetLanguage, model)
  return result.translations
}

/** A Tag run's prompt from its Covered Posts, and how many were missing. */
export const getTagPrompt = (body: TagRequest): Promise<ArtifactPrompt> =>
  api.tagPrompt(body)

export const generateTagStream = async (
  body: TagRequest,
): Promise<LLMStreamResult> => {
  try {
    const missing = missingPostsFrame()
    const stream = api.tagStream(body, missing.onFrame)
    return {
      stream: wrapStream(stream),
      prompt: `tag_mode=${body.tagMode}; tagRun=${body.tagRunId}`,
      config: { temperature: body.temperature ?? 0.7 },
      missingPosts: missing.read,
    }
  } catch (error: unknown) {
    throw new AIServiceError(
      error instanceof Error ? error.message : "Failed to generate tag stream",
    )
  }
}
