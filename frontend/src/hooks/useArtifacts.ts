import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback } from "react"

import { api } from "@/api"
import { findTabArtifacts } from "@/lib/workspace-tabs"
import type { ArtifactKind, ArtifactListItem } from "@/types"

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"

/** One server page. Small, because History renders a card per row. */
export const ARTIFACT_PAGE_SIZE = 40

/**
 * The unified History list.
 *
 * `useInfiniteQuery` rather than a plain query, because the four kinds are
 * paged *together* server-side: the union is what decides the interleaving, and
 * fetching four capped lists to merge in the browser gives a "load more" that
 * cannot mean anything. The stable `(timestamp DESC, id)` ordering is what
 * makes `offset` paging safe here — without the id tiebreak, equal timestamps
 * let rows repeat across pages.
 */
export function useArtifactsQuery(
  kind: ArtifactKind | null,
  search: string,
  starred = false,
) {
  const trimmed = search.trim()
  return useInfiniteQuery({
    queryKey: queryKeys.artifacts(kind, trimmed, starred),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.listArtifacts({
        kind: kind ?? undefined,
        search: trimmed || undefined,
        starred: starred || undefined,
        limit: ARTIFACT_PAGE_SIZE,
        offset: pageParam as number,
      }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < ARTIFACT_PAGE_SIZE
        ? undefined
        : allPages.length * ARTIFACT_PAGE_SIZE,
    staleTime: SUMMARIZER_STALE_TIME,
    refetchOnWindowFocus: true,
  })
}

/** Flattened rows, for a component that only wants the list. */
export function useArtifacts(
  kind: ArtifactKind | null,
  search: string,
  starred = false,
): { rows: ArtifactListItem[]; query: ReturnType<typeof useArtifactsQuery> } {
  const query = useArtifactsQuery(kind, search, starred)
  return { rows: query.data?.pages.flat() ?? [], query }
}

/**
 * Invalidate every artifact page, whatever kind or search it was keyed on.
 *
 * Deliberately a prefix match: starring a tag run has to refresh the "all" list
 * and the "tag" list, and any search that happened to include it.
 */
export function useInvalidateArtifacts() {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["artifacts"] })
  }, [queryClient])
}

/**
 * The open tabs' Artifacts, looked up in the History list (TABS-01).
 *
 * Answers "does this account have any Artifact" (History joins the strip) and
 * "does each tab's Artifact still exist" (reconcile), and carries the rows the
 * tab labels are drawn from. The list is paged, so it walks pages until every
 * key is found or the list ends: the open tabs are nearly always recent, so
 * that is one request, and a tab whose Artifact is gone pays for a full walk
 * once before reconcile closes it.
 *
 * Keyed under `artifacts`, so every `useInvalidateArtifacts` (a delete in
 * History) re-runs reconcile as well.
 */
export function useArtifactTabLookup(keys: readonly string[]) {
  return useQuery({
    queryKey: queryKeys.artifactTabs(keys),
    queryFn: () =>
      findTabArtifacts(keys, ARTIFACT_PAGE_SIZE, (offset) =>
        api.listArtifacts({ limit: ARTIFACT_PAGE_SIZE, offset }),
      ),
    staleTime: SUMMARIZER_STALE_TIME,
  })
}
