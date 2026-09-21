import { useQuery } from "@tanstack/react-query"

import { aiApi } from "@/api/ai"
import { queryKeys } from "./queryKeys"
import { useSelectedAiKeyId } from "./useAiKeys"

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
 * than an error precisely so the combo below falls back to free text.
 *
 * **With no Key selected the question is not asked at all.** `POST /ai/models`
 * resolves a Key and answers 400 without one, so every mount of the Action tab
 * on a fresh account used to fire a request that could only fail. Skipping it
 * also makes the empty list mean one thing instead of two: with a Key, "this
 * provider serves no catalogue", which is what `ModelCombo` suppresses its
 * warning on. Without a Key the control is disabled and asks nothing.
 *
 * The server caches per Key for ten minutes, and this caches again for the same
 * span, so opening the Action tab repeatedly costs one outbound call at most.
 */

const empty: { id: string; label: string }[] = []

export function useAiModels(): {
  models: { id: string; label: string }[]
  isLoading: boolean
} {
  const aiKeyId = useSelectedAiKeyId()
  const query = useQuery({
    queryKey: queryKeys.aiModels(aiKeyId),
    queryFn: () => aiApi.listModels(aiKeyId),
    enabled: !!aiKeyId,
    staleTime: 600_000,
    // One failed listing must not stop somebody typing a model id: every
    // surface renders the free-text fallback when the list is empty, and a
    // retry storm against a provider that has no `/models` route is worse than
    // no list at all.
    retry: false,
  })
  return {
    models: query.data?.models ?? empty,
    isLoading: query.isLoading,
  }
}
