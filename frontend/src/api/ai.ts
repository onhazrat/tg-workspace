import { request, sseTextStream } from "./base";

export const aiApi = {
  listModels: () =>
    request<{ models: { id: string; label: string; provider: string }[]; default: string }>(
      "/api/v1/ai/models"
    ),

  summaryStream: (body: Record<string, unknown>) =>
    sseTextStream("/api/v1/ai/summary/stream", body, "text"),

  chatStream: (body: Record<string, unknown>) =>
    sseTextStream("/api/v1/ai/chat/stream", body, "text"),

  embeddings: (texts: string[], model?: string) =>
    request<{ vectors: number[][]; dimensions: number }>("/api/v1/ai/embeddings", {
      method: "POST",
      body: JSON.stringify({ texts, model }),
    }),

  translateBatch: (
    posts: { id: string; text: string }[],
    targetLanguage: string,
    model?: string
  ) =>
    request<{ translations: { id: string; translation: string }[] }>("/api/v1/ai/translate", {
      method: "POST",
      body: JSON.stringify({ posts, targetLanguage, model }),
    }),
};
