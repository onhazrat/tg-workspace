import { api } from "@/api"
import { saveEmbeddingLog } from "../lib/repository"
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
}

export interface LLMResult {
  text: string
  prompt: string
  config: { temperature: number }
  fullResponse?: { usageMetadata?: { totalTokenCount?: number }; text?: string }
}

async function* wrapStream(
  gen: AsyncGenerator<string, void, unknown>,
): AsyncGenerator<{ text: string }, void, unknown> {
  for await (const text of gen) {
    yield { text }
  }
}

export const getSummaryPrompt = async (
  channels: string[],
  channelsText: string,
  postsText: string,
  language: string,
  model: string,
  temperature: number = 0.7,
): Promise<string> => {
  const result = await api.summaryPrompt({
    channels,
    channelsText,
    postsText,
    language,
    model,
    temperature,
  })
  return result.prompt
}

export const generateSummaryStream = async (
  channels: string[],
  channelsText: string,
  postsText: string,
  language: string,
  model: string,
  temperature: number = 0.7,
): Promise<LLMStreamResult> => {
  const prompt = `channels=${channels.join(",")}`
  try {
    const stream = api.summaryStream({
      channels,
      channelsText,
      postsText,
      language,
      model,
      temperature,
    })
    return { stream: wrapStream(stream), prompt, config: { temperature } }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to generate summary stream"
    throw new AIServiceError(message)
  }
}

export const generateSummary = async (
  channels: string[],
  channelsText: string,
  postsText: string,
  language: string,
  model: string,
  temperature: number = 0.7,
): Promise<LLMResult> => {
  let text = ""
  const { stream, prompt, config } = await generateSummaryStream(
    channels,
    channelsText,
    postsText,
    language,
    model,
    temperature,
  )
  for await (const chunk of stream) {
    text += chunk.text
  }
  return { text, prompt, config, fullResponse: { text } }
}

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

export const generateChatStream = async (
  channels: string[],
  channelsText: string,
  postsText: string,
  language: string,
  model: string,
  history: { role: "user" | "model"; text: string }[],
  userMessage: string,
  temperature: number = 0.7,
): Promise<LLMStreamResult> => {
  try {
    const stream = api.chatStream({
      channels,
      channelsText,
      postsText,
      language,
      model,
      history,
      message: userMessage,
      temperature,
      ragMode: false,
    })
    return {
      stream: wrapStream(stream),
      prompt: userMessage,
      config: { temperature },
    }
  } catch (error: unknown) {
    throw new AIServiceError(
      error instanceof Error ? error.message : "Failed to generate chat stream",
    )
  }
}

export const chatWithHistoryStream = async (
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
      channels: [],
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

export const getTagPrompt = async (body: {
  channels: string[]
  channelsText: string
  postsText: string
  allTags: string
  tagMode: "add" | "remove"
  language: string
  model: string
  temperature?: number
}): Promise<string> => {
  const result = await api.tagPrompt(body)
  return result.prompt
}

export const generateTagStream = async (body: {
  channels: string[]
  channelsText: string
  postsText: string
  allTags: string
  tagMode: "add" | "remove"
  language: string
  model: string
  temperature?: number
}): Promise<LLMStreamResult> => {
  try {
    const stream = api.tagStream(body)
    return {
      stream: wrapStream(stream),
      prompt: `tag_mode=${body.tagMode}; channels=${body.channels.join(",")}`,
      config: { temperature: body.temperature ?? 0.7 },
    }
  } catch (error: unknown) {
    throw new AIServiceError(
      error instanceof Error ? error.message : "Failed to generate tag stream",
    )
  }
}
