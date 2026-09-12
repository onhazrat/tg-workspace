import { selectedAiKeyId } from "@/lib/aiKeys/selection"

import { request, sseTextStream } from "./base"
import { type PromptScope, promptScopeBody } from "./data"

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
const withAiKey = (body: Record<string, unknown>): Record<string, unknown> => {
  const aiKeyId = selectedAiKeyId()
  return aiKeyId ? { ...body, aiKeyId } : body
}

/**
 * Convert a Scope's Analysis window to the wire form (AW-02).
 *
 * Here rather than at each call site for the same reason `withAiKey` is: the
 * three streams build their bodies in their contexts and hand over an opaque
 * bag, so this is the last place that still knows a `scope` is in there. A
 * body with no scope passes through untouched — the semantic and related paths
 * ship a pre-built `postsText` instead.
 */
const withPromptScope = (
  body: Record<string, unknown>,
): Record<string, unknown> => {
  const scope = body.scope as PromptScope | undefined
  return scope ? { ...body, scope: promptScopeBody(scope) } : body
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
      models: { id: string; label: string; provider: string }[]
      default: string
    }>("/api/v1/ai/models", {
      method: "POST",
      body: JSON.stringify(aiKeyId ? { aiKeyId } : {}),
    }),

  summaryPrompt: (body: {
    channels: string[]
    channelsText?: string
    postsText: string
    language: string
    model?: string
    temperature?: number
    scope?: PromptScope
  }) =>
    request<{ prompt: string }>("/api/v1/ai/summary/prompt", {
      method: "POST",
      body: JSON.stringify(withPromptScope(body)),
    }),

  summaryStream: (body: Record<string, unknown>) =>
    sseTextStream(
      "/api/v1/ai/summary/stream",
      withAiKey(withPromptScope(body)),
      "text",
    ),

  tagPrompt: (body: {
    channels: string[]
    channelsText: string
    postsText: string
    allTags: string
    tagMode: "add" | "remove"
    language: string
    model?: string
    temperature?: number
    scope?: PromptScope
  }) =>
    request<{ prompt: string }>("/api/v1/ai/tag/prompt", {
      method: "POST",
      body: JSON.stringify(withPromptScope(body)),
    }),

  tagStream: (body: Record<string, unknown>) =>
    sseTextStream(
      "/api/v1/ai/tag/stream",
      withAiKey(withPromptScope(body)),
      "text",
    ),

  chatStream: (body: Record<string, unknown>) =>
    sseTextStream(
      "/api/v1/ai/chat/stream",
      withAiKey(withPromptScope(body)),
      "text",
    ),

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
