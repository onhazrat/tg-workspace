import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  reconcileAiKeySelection,
  useStoredAiKeyId,
} from "@/lib/aiKeys/selection"
import { type AiKey, listAiKeys } from "@/lib/aiKeys/store"

import { queryKeys } from "./queryKeys"

/**
 * The account's AI Keys (BYOK-01).
 *
 * A key of its own rather than a third slot on `bots`: those two travel
 * together because a publish target is a `(credential, destination)` pair, and
 * an AI Key is not part of that pair. Sharing the key would refetch both
 * credential families every time somebody opened the Action tab.
 */

const empty: AiKey[] = []

export function useAiKeysQuery() {
  return useQuery({
    queryKey: queryKeys.aiKeys,
    queryFn: async () => {
      const keys = await listAiKeys()
      // The one moment the client knows which Keys still exist, so it is where
      // a remembered id for a deleted one is dropped. See
      // `reconcileAiKeySelection` for what goes wrong without it.
      reconcileAiKeySelection(keys)
      return keys
    },
    staleTime: 30_000,
  })
}

/**
 * Which Key pays for the next Artifact, or `null` when the Account has none.
 *
 * **Here rather than in `lib/aiKeys/selection.ts`, and it mounts the query.**
 * The selection is written by `reconcileAiKeySelection` inside that query's
 * `queryFn`, so on a screen that never fetches the Key list the stored value is
 * whatever a previous screen left — `null` in a fresh browser. Three of the
 * four `ModelCombo` call sites are such screens (Chat, and both Settings → AI
 * pickers, which are a different sub-tab from AI Keys), and reading the store
 * alone left them permanently disabled saying "Add a key first" for an Account
 * that holds several. Asking for the selection is therefore also asking for the
 * list; the query is shared and cached, so the second caller costs nothing.
 */
export function useSelectedAiKeyId(): string | null {
  useAiKeysQuery()
  return useStoredAiKeyId()
}

/** The keys, with a stable empty default. */
export function useAiKeys(): AiKey[] {
  return useAiKeysQuery().data ?? empty
}

/**
 * Refetch after a save or delete.
 *
 * Invalidate rather than write through, unlike `bots`. A save's response
 * carries `lastValidated` set by a round trip to the provider, so there is no
 * local value to write that would be correct — and the list is three rows, so
 * the refetch costs nothing worth optimising.
 */
export function useRefreshAiKeys() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.aiKeys })
}
