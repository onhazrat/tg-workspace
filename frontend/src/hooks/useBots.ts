import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { SetStateAction } from "react"

import { applySetStateAction } from "@/lib/applySetStateAction"
import { listBotCredentials, listChatDestinations } from "@/lib/bots/store"
import type { BotCredential, ChatDestination } from "@/types"

import { queryKeys } from "./queryKeys"

/**
 * Bot credentials and chat destinations, in one cache entry.
 *
 * They share a key because every consumer needs both — a publish target is a
 * `(credential, destination)` pair — and splitting them would double the
 * requests for no independent use.
 *
 * Extracted from `DataContext` in G2.2. It is the same query, the same key and
 * the same write-through setters; what changed is that consumers reach it
 * directly rather than through eleven levels of provider.
 */
export interface BotsQueryResult {
  credentials: BotCredential[]
  destinations: ChatDestination[]
}

const emptyCredentials: BotCredential[] = []
const emptyDestinations: ChatDestination[] = []

export function useBotsQuery() {
  return useQuery({
    queryKey: queryKeys.bots,
    queryFn: async (): Promise<BotsQueryResult> => {
      const [credentials, destinations] = await Promise.all([
        listBotCredentials(),
        listChatDestinations(),
      ])
      return { credentials, destinations }
    },
    staleTime: 30_000,
  })
}

/** Credentials only, with a stable empty default. */
export function useBotCredentials(): BotCredential[] {
  return useBotsQuery().data?.credentials ?? emptyCredentials
}

/** Destinations only, with a stable empty default. */
export function useChatDestinations(): ChatDestination[] {
  return useBotsQuery().data?.destinations ?? emptyDestinations
}

/**
 * Write-through for the `credentials` half, preserving `destinations`.
 *
 * `bots/store.ts` deliberately does not invalidate on write (see its docstring)
 * — these setters are how a save reaches the UI, so they must keep working
 * exactly as they did.
 */
export function setBotCredentialsInCache(
  queryClient: QueryClient,
  action: SetStateAction<BotCredential[]>,
): void {
  queryClient.setQueryData<BotsQueryResult>(queryKeys.bots, (old) => ({
    credentials: applySetStateAction(action, old?.credentials ?? []),
    destinations: old?.destinations ?? [],
  }))
}

/** Write-through for the `destinations` half, preserving `credentials`. */
export function setChatDestinationsInCache(
  queryClient: QueryClient,
  action: SetStateAction<ChatDestination[]>,
): void {
  queryClient.setQueryData<BotsQueryResult>(queryKeys.bots, (old) => ({
    credentials: old?.credentials ?? [],
    destinations: applySetStateAction(action, old?.destinations ?? []),
  }))
}

export function useSetBotCredentials() {
  const queryClient = useQueryClient()
  return (action: SetStateAction<BotCredential[]>) =>
    setBotCredentialsInCache(queryClient, action)
}

export function useSetChatDestinations() {
  const queryClient = useQueryClient()
  return (action: SetStateAction<ChatDestination[]>) =>
    setChatDestinationsInCache(queryClient, action)
}
