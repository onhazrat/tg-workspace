import { useQuery, useQueryClient } from "@tanstack/react-query"

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
    queryFn: listAiKeys,
    staleTime: 30_000,
  })
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
