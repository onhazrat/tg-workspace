import { request } from "./base"

export const ragApi = {
  ragSearch: (body: Record<string, unknown>) =>
    request("/api/v1/rag/search", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  ragStatus: () =>
    request<{ pending: number; total: number; lastRun: number | null }>(
      "/api/v1/rag/status",
    ),

  ragEmbed: (body: { limit?: number } = {}) =>
    request<{ processed: number; upserted: number; pending: number }>(
      "/api/v1/rag/embed",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
}
