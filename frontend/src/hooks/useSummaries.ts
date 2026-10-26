import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { watchSummaryAttempt } from "@/api/data"
import {
  dataCancelSummaryAttempt,
  dataDismissSummaryPartial,
  dataKeepSummaryPartial,
  dataListSummaryAttempts,
  dataRestoreSummaryPartial,
  dataStartSummaryAttempt,
  dataStopSummaryAttempt,
} from "@/client"
import { errorText } from "@/lib/artifacts/artifact-run"
import { getSummary, listSummaries } from "@/lib/summaries/store"
import { followAttempt } from "@/lib/summaries/summary-run"

import type { SummaryListItem } from "@/types"

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
/**
 * A Summary's Attempts, oldest first (SFR-01). Fetched for the Summary on
 * screen: a running one streams in, and one that took several gets a fold.
 */
export function useSummaryAttemptsQuery(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.summaryAttempts(id ?? ""),
    queryFn: () =>
      dataListSummaryAttempts({ path: { summary_id: id as string } }),
    enabled: !!id && enabled,
  })
}

export function useSummaryDetailQuery(id: string | null) {
  return useQuery({
    queryKey: queryKeys.summary(id ?? ""),
    queryFn: () => getSummary(id as string).then((s) => s ?? null),
    enabled: !!id,
    staleTime: SUMMARIZER_STALE_TIME,
  })
}

const emptyHistory: SummaryListItem[] = []

/**
 * The history list itself, with a stable empty default.
 *
 * Extracted from `DataContext` in G2.3, where it was `summariesQuery.data ??
 * emptyArray`. Consumers that only need the rows use this; the ones that also
 * need loading state keep `useSummariesQuery()`.
 */
export function useSummariesHistory(): SummaryListItem[] {
  return useSummariesQuery().data ?? emptyHistory
}

export function useInvalidateSummaries() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.summaries })
}

/** Everything that shows a Summary's state, after an Attempt moved it. */
export function invalidateSummaryState(queryClient: QueryClient, id: string) {
  return Promise.all([
    // Its Attempts too: `summaryAttempts(id)` sits under `summary(id)`.
    queryClient.invalidateQueries({ queryKey: queryKeys.summary(id) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.summaries }),
    queryClient.invalidateQueries({ queryKey: ["artifacts"] }),
  ])
}

/**
 * The text of the Attempt the worker is running, as it arrives (SFR-02).
 *
 * Attaches whenever there is a running Attempt, so a Summary reopened
 * mid-Attempt, on any device, picks up where it is. When the Attempt ends the
 * Summary and its Attempts are read again, which is what turns the page into
 * the finished report or the failure.
 */
export function useRunningAttemptText(
  summaryId: string | null,
  attemptId: string | null,
): string {
  const queryClient = useQueryClient()
  const [text, setText] = useState("")
  useEffect(() => {
    setText("")
    if (!summaryId || !attemptId) return
    const controller = new AbortController()
    const watch = async () => {
      const ended = await followAttempt(
        watchSummaryAttempt(summaryId, attemptId, controller.signal),
        (piece) => setText((t) => t + piece),
        controller.signal,
      )
      if (ended) await invalidateSummaryState(queryClient, summaryId)
    }
    void watch()
    return () => controller.abort()
  }, [summaryId, attemptId, queryClient])
  return text
}

/**
 * The Summary on screen's Attempts and what can be done with them (SFR-02):
 * the running one's text, Retry on the last Attempt's model and Key (which the
 * server defaults to), and Stop.
 */
export function useSummaryAttempts(
  summaryId: string | null,
  temperature: number,
) {
  const queryClient = useQueryClient()
  const { data } = useSummaryAttemptsQuery(summaryId, true)
  const attempts = data ?? []
  const running = attempts.find((a) => a.outcome === "running")
  const runningText = useRunningAttemptText(summaryId, running?.id ?? null)

  /** Without a choice the server reruns the last Attempt's Key and model. */
  const retry = async (
    id: string,
    choice?: { keyId: string | null; model: string },
  ) => {
    try {
      const started = await dataStartSummaryAttempt({
        path: { summary_id: id },
        body: {
          temperature,
          ...(choice && { model: choice.model, aiKeyId: choice.keyId }),
        },
      })
      if (started?.error) toast.error(started.error)
    } catch (err: unknown) {
      toast.error(errorText(err, "The retry could not start."))
    }
    await invalidateSummaryState(queryClient, id)
  }

  /** One call on one Attempt, then everything that shows it is read again. */
  const act =
    (
      call: (options: {
        path: { summary_id: string; attempt_id: string }
      }) => Promise<unknown>,
      failure: string,
    ) =>
    async (id: string, attemptId: string) => {
      try {
        await call({ path: { summary_id: id, attempt_id: attemptId } })
      } catch (err: unknown) {
        toast.error(errorText(err, failure))
      }
      await invalidateSummaryState(queryClient, id)
    }

  return {
    attempts,
    runningText,
    retry,
    stop: act(dataStopSummaryAttempt, "Could not stop the Attempt."),
    // SFR-03: the automatic retry's Cancel, and the Partial responses.
    cancel: act(dataCancelSummaryAttempt, "Could not cancel the retry."),
    keep: act(dataKeepSummaryPartial, "Could not keep that draft."),
    dismiss: act(dataDismissSummaryPartial, "Could not dismiss that draft."),
    restore: act(dataRestoreSummaryPartial, "Could not restore that draft."),
  }
}
