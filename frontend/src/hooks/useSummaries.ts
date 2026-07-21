import { useQuery, useQueryClient } from "@tanstack/react-query"

import { getSummary, listSummaries } from "@/lib/repository"

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"

/** Metadata-only history. Use `useSummaryDetailQuery` for the heavy fields. */
export function useSummariesQuery() {
  return useQuery({
    queryKey: queryKeys.summaries,
    queryFn: async () => {
      const history = await listSummaries()
      return [...history].sort((a, b) => b.timestamp - a.timestamp)
    },
    staleTime: SUMMARIZER_STALE_TIME,
    refetchOnWindowFocus: true,
  })
}

/**
 * Server-side summary search.
 *
 * Matching happens in SQL because `promptText` — which the search covers — is
 * no longer shipped to the client. Disabled for a blank query so the caller
 * can fall back to the already-loaded history list.
 */
export function useSummarySearchQuery(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: [...queryKeys.summaries, "search", trimmed] as const,
    queryFn: () => listSummaries({ search: trimmed }),
    enabled: trimmed.length > 0,
    staleTime: SUMMARIZER_STALE_TIME,
    placeholderData: (previous) => previous,
  })
}

/**
 * One summary in full, including citedPosts/promptText/chatMessages.
 *
 * These are excluded from the list because `promptText` alone was ~94% of the
 * list payload; anything that needs them fetches the row it is actually
 * looking at.
 */
export function useSummaryDetailQuery(id: string | null) {
  return useQuery({
    queryKey: queryKeys.summary(id ?? ""),
    queryFn: () => getSummary(id as string).then((s) => s ?? null),
    enabled: !!id,
    staleTime: SUMMARIZER_STALE_TIME,
  })
}

export function useInvalidateSummaries() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.summaries })
}
