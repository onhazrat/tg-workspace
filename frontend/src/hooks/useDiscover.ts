import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/api"
import type { DiscoverScopeQuery } from "@/api/data"
import type { DiscoverySignalKind } from "@/lib/posts/discover-candidates"

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys"

export type DiscoverCandidatesParams = DiscoverScopeQuery & {
  signals?: DiscoverySignalKind[]
}

/**
 * Stateless Discover aggregation — computes without saving.
 *
 * Discover itself generates saved reports; this remains for callers that want
 * the aggregate without creating an artifact.
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

/** A specific saved report, for reopening one from history. */
export function useDiscoverReportQuery(reportId: string | null) {
  return useQuery({
    queryKey: queryKeys.discoverReport(reportId ?? ""),
    queryFn: () => api.getDiscoverReport(reportId as string),
    enabled: Boolean(reportId),
    staleTime: SUMMARIZER_STALE_TIME,
  })
}

/** Saved reports, newest first, in the light projection. */
export function useDiscoverReportsQuery(search?: string) {
  return useQuery({
    queryKey: [...queryKeys.discoverReports, search ?? ""],
    queryFn: () => api.listDiscoverReports(search ? { search } : undefined),
    staleTime: SUMMARIZER_STALE_TIME,
  })
}

/**
 * Generate and save a report.
 *
 * Seeds the new report into its own cache entry and into `latest` so opening
 * Discover, or reopening this report from history, does not refetch what the
 * mutation already returned.
 */
export function useCreateDiscoverReportMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: DiscoverCandidatesParams) =>
      api.createDiscoverReport(params),
    onSuccess: (report) => {
      queryClient.setQueryData(queryKeys.discoverReport(report.id), report)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.discoverReports,
      })
    },
  })
}

/**
 * Dismiss or restore candidates.
 *
 * `isIgnored` is resolved server-side per read, so every saved report reflects
 * the change — hence invalidating reports wholesale rather than patching the
 * one on screen.
 */
export function useDiscoverIgnoreMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      handles,
      ignored,
    }: {
      handles: string[]
      ignored: boolean
    }): Promise<string[]> => {
      // The two endpoints report their effect under different keys; the caller
      // only cares which handles actually changed.
      if (ignored) {
        return (await api.ignoreDiscoverChannels(handles)).ignored
      }
      return (await api.unignoreDiscoverChannels(handles)).removed
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["discoverReport"] })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.discoverIgnored,
      })
    },
  })
}

export function useDeleteDiscoverReportMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reportId: string) => api.deleteDiscoverReport(reportId),
    onSuccess: (_result, reportId) => {
      queryClient.removeQueries({
        queryKey: queryKeys.discoverReport(reportId),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.discoverReports,
      })
    },
  })
}
