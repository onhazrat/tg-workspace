import type {
  ChatRequest,
  PromptResponse,
  SummaryPromptRequest,
  TagRequest,
} from "@/client"
import { selectedAiKeyId } from "@/lib/aiKeys/selection"

import { type OnFrame, request, sseTextStream } from "./base"

/** An Artifact's prompt and how many Covered Posts it left out (ADR-038). */
export type ArtifactPrompt = Required<PromptResponse>

/**
 * Stamp the paying Key onto an Artifact request (BYOK-01).
 *
 * Here rather than threaded through `services/ai.ts`, because the three
 * generators already take eight positional arguments each and a ninth that
 * every caller passes identically is prop-drilling with extra steps. The
 * selection has one source of truth — the account-namespaced storage the
 * chooser writes — and this is the one place that reads it, the same shape
 * `api/base.ts` uses for the auth token.
 *
 * Sending nothing is a real answer, not a fallback: `resolve_ai_key` then picks
 * the account's most recent working Key, which is exactly right for the common
 * case of holding one.
 */
const withAiKey = <T extends object>(body: T): T => {
  const aiKeyId = selectedAiKeyId()
  return aiKeyId ? { ...body, aiKeyId } : body
}

export const aiApi = {
  /**
   * What the chosen Key's provider offers (BYOK-02).
   *
   * A POST, and it sends the Key like every other Artifact call: this stopped
   * being a static list and became an outbound call on somebody's own
   * credential, so it needs to know whose. The response is cached per Key
   * server-side, which is what makes it safe to call from a dropdown.
   */
  listModels: (aiKeyId?: string | null) =>
    request<{
      models: {
        id: string
        label: string
        provider: string
        /** Tokens the model accepts; `null` when the Provider does not say. */
        contextLength: number | null
      }[]
      default: string
    }>("/api/v1/ai/models", {
      method: "POST",
      body: JSON.stringify(aiKeyId ? { aiKeyId } : {}),
    }),

  /** A Summary's prompt, read from its Covered Posts (ADR-038). */
  summaryPrompt: (body: SummaryPromptRequest) =>
    request<ArtifactPrompt>("/api/v1/ai/summary/prompt", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** A Tag run's prompt, read from its Covered Posts (ADR-038). */
  tagPrompt: (body: TagRequest) =>
    request<ArtifactPrompt>("/api/v1/ai/tag/prompt", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  tagStream: (body: TagRequest, onFrame?: OnFrame) =>
    sseTextStream("/api/v1/ai/tag/stream", withAiKey(body), "text", onFrame),

  chatStream: (body: ChatRequest, onFrame?: OnFrame) =>
    sseTextStream("/api/v1/ai/chat/stream", withAiKey(body), "text", onFrame),

  embeddings: (texts: string[], model?: string) =>
    request<{ vectors: number[][]; dimensions: number }>(
      "/api/v1/ai/embeddings",
      {
        method: "POST",
        body: JSON.stringify({ texts, model }),
      },
    ),

  translateBatch: (
    posts: { id: string; text: string }[],
    targetLanguage: string,
    model?: string,
  ) =>
    request<{ translations: { id: string; translation: string }[] }>(
      "/api/v1/ai/translate",
      {
        method: "POST",
        body: JSON.stringify({ posts, targetLanguage, model }),
      },
    ),
}
