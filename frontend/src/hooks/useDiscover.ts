import { useQuery } from "@tanstack/react-query"

import { api } from "@/api"
import type { PostScopeQuery } from "@/api/data"
import type { DiscoverySignalKind } from "@/lib/posts/discover-candidates"

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"

export type DiscoverCandidatesParams = PostScopeQuery & {
  signals: DiscoverySignalKind[]
}

/**
 * Server-side Discover aggregation.
 *
 * Only enabled when the caller has decided the scope is reproducible
 * server-side (no semantic query, cap not in `random` mode) and there is a
 * scope to aggregate. When disabled, the caller falls back to the client
 * `computeDiscoveryCandidates` path.
 */
export function useDiscoverCandidatesQuery(
  params: DiscoverCandidatesParams,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.discoverCandidates(params),
    queryFn: () => api.getDiscoverCandidates(params),
    enabled,
    staleTime: SUMMARIZER_STALE_TIME,
    placeholderData: (previous) => previous,
  })
}

/**
 * Per-channel post counts for a filtered scope, computed in SQL.
 *
 * Replaces the client-side tally over the full fetched post array. Enabled only
 * when a scope is present; the caller keeps prior counts as placeholder data so
 * the grid does not flicker between scope changes.
 */
export function usePostsCountsQuery(params: PostScopeQuery, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.postsCounts(params),
    queryFn: () => api.getPostsCounts(params),
    enabled,
    staleTime: SUMMARIZER_STALE_TIME,
    placeholderData: (previous) => previous,
  })
}
