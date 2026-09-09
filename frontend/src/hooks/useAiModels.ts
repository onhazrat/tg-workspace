import { useQuery } from "@tanstack/react-query"

import { aiApi } from "@/api/ai"
import { selectedAiKeyId } from "@/lib/aiKeys/selection"

import { queryKeys } from "./queryKeys"

/**
 * The models the account's chosen provider offers (BYOK-02).
 *
 * This replaced three Gemini ids hardcoded in `constants.ts` and hardcoded a
 * second time in the backend. Both are gone: one OpenRouter key reaches several
 * hundred models, so a list the deployment ships cannot be right for anybody
 * except the person who wrote it.
 *
 * **An empty list is a normal answer, not a failure.** A local Ollama or a bare
 * vLLM serves no `/models` route, and the server turns that into `[]` rather
 * than an error precisely so the combo below falls back to free text. The same
 * is true before an account has saved its first Key — there is nothing to ask.
 *
 * The server caches per Key for ten minutes, and this caches again for the same
 * span, so opening the Action tab repeatedly costs one outbound call at most.
 */

const empty: { id: string; label: string }[] = []

export function useAiModels(): {
  models: { id: string; label: string }[]
  /** A model id this provider will accept, for a stored value it will not. */
  fallback: string
  isLoading: boolean
} {
  const aiKeyId = selectedAiKeyId()
  const query = useQuery({
    queryKey: queryKeys.aiModels(aiKeyId),
    queryFn: () => aiApi.listModels(aiKeyId),
    staleTime: 600_000,
    // One failed listing must not stop somebody typing a model id: every
    // surface renders the free-text fallback when the list is empty, and a
    // retry storm against a provider that has no `/models` route is worse than
    // no list at all.
    retry: false,
  })
  return {
    models: query.data?.models ?? empty,
    fallback: query.data?.default ?? "",
    isLoading: query.isLoading,
  }
}
