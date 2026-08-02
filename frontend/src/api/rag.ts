import { ragRagEmbed, ragRagStatus } from "@/client"
import { request } from "./base"

/**
 * RAG API — split by whether the generated type is actually usable (see
 * `api/jobs.ts` and ADR-006; `api/client-split.conform.ts` enforces it).
 *
 * `ragSearch` is the case that showed openness is not the whole rule. Its model
 * `RagSearchResponse` is closed, and so is the `PostResponse` nested two levels
 * down — but *every field* on `PostResponse` is optional, because each has a
 * server-side default and OpenAPI cannot say "defaulted, therefore always
 * present". So it is not assignable to the frontend `Post`, and moving this
 * call would hand callers something they must cast back before use.
 */
export const ragApi = {
  // Closed but not assignable to `Post` — hand-written. See above.
  ragSearch: (body: Record<string, unknown>) =>
    request("/api/v1/rag/search", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Closed response models — generated.
  ragStatus: () => ragRagStatus(),

  ragEmbed: (body: { limit?: number } = {}) => ragRagEmbed({ body }),
}
