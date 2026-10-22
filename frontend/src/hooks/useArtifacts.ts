import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback } from "react"

import { api } from "@/api"
import { dataCountArtifactsRoute, dataGetArtifactSpreadRoute } from "@/client"
import type { Range } from "@/components/SpreadZoom"
import type { HistoryParams } from "@/lib/history/history-params"
import { findTabArtifacts } from "@/lib/workspace-tabs"
import type { ArtifactListItem } from "@/types"

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"

/** One server page. Small, because History renders a card per row. */
export const ARTIFACT_PAGE_SIZE = 40

/** The filters the list, the counts and the spread all send. */
function filterQuery(p: HistoryParams) {
  const search = p.search.trim()
  return {
    ...(p.kind && { kind: p.kind }),
    ...(search && { search }),
    ...(p.starred && { starred: true }),
    ...(p.status && { status: p.status }),
    ...(p.moment === "window" && { moment: p.moment }),
  }
}

/** The filters and the time filter's bound: the list's and the counts'. */
function boundedQuery(p: HistoryParams) {
  const { mode, start, end } = p.bound
  const bounded = start !== undefined || end !== undefined
  return {
    ...filterQuery(p),
    ...(bounded && { mode }),
    ...(start !== undefined && { start }),
    ...(end !== undefined && { end }),
  }
}

/**
 * The unified History list.
 *
 * `useInfiniteQuery` rather than a plain query, because the four kinds are
 * paged *together* server-side: the union is what decides the interleaving, and
 * fetching four capped lists to merge in the browser gives a "load more" that
 * cannot mean anything. Every sort ends on the id, which is what makes
 * `offset` paging safe here — without that tiebreak, equal keys let rows
 * repeat across pages.
 */
export function useArtifactsQuery(p: HistoryParams) {
  const query = {
    ...boundedQuery(p),
    ...(p.sort === "window" && { sort: p.sort }),
    ...(!p.descending && { descending: false }),
  }
  return useInfiniteQuery({
    queryKey: queryKeys.artifacts("list", query),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.listArtifacts({
        ...query,
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
export function useArtifacts(p: HistoryParams): {
  rows: ArtifactListItem[]
  query: ReturnType<typeof useArtifactsQuery>
} {
  const query = useArtifactsQuery(p)
  return { rows: query.data?.pages.flat() ?? [], query }
}

/** The footer's total and each Kind and Status choice's count. */
export function useArtifactCounts(p: HistoryParams) {
  const query = boundedQuery(p)
  return useQuery({
    queryKey: queryKeys.artifacts("counts", query),
    queryFn: () => dataCountArtifactsRoute({ query }),
    placeholderData: keepPreviousData,
    staleTime: SUMMARIZER_STALE_TIME,
  })
}

/** The time filter's spread: every filter but the bound, zoomed by `range`. */
export function useArtifactSpread(p: HistoryParams, range: Range | null) {
  const query = {
    ...filterQuery(p),
    ...(range && { lo: range[0], hi: range[1] }),
  }
  return useQuery({
    queryKey: queryKeys.artifacts("spread", query),
    queryFn: () => dataGetArtifactSpreadRoute({ query }),
    placeholderData: keepPreviousData,
    staleTime: SUMMARIZER_STALE_TIME,
  })
}

/**
 * Invalidate every artifact query, whatever it was keyed on.
 *
 * Deliberately a prefix match: starring a tag run has to refresh the "all" list
 * and the "tag" list, any search that happened to include it, the counts and
 * the spread.
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
