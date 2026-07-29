import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"

import { api, type DiscoverProbeJob } from "@/api"
import { queryKeys } from "@/hooks/queryKeys"
import type { DiscoveryCandidate } from "@/lib/posts/discover-candidates"

/** How often to ask the server how far the sweep has got. */
const POLL_INTERVAL_MS = 1500

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"])

interface UseDiscoverProbeSweepOptions {
  /** Report candidates, already ranked — the sweep probes in this order. */
  candidates: DiscoveryCandidate[]
  /** Skip entirely while offline or before a report has loaded. */
  enabled: boolean
}

/**
 * Runs and tracks the background sweep that resolves what each handle is (D9).
 *
 * ## Why this polls instead of streaming
 *
 * Sync and bulk-follow push over SSE because their per-item results exist only
 * inside the job. A probe's result is a row in the probe table, which the
 * report read already joins, so the only thing the client needs from the job is
 * a progress count — and it has to refetch the report anyway to pick up the
 * verdicts. A stream would add a second delivery path for data already arriving
 * through the first.
 *
 * ## Why it auto-starts
 *
 * The value of the feature is that a report arrives already triaged; a sweep
 * behind a button would mean reading the untriaged list first, which is the
 * problem it exists to solve. What keeps that safe is the server-side cache
 * check: a sweep is only created for handles with no verdict yet, so this
 * costs nothing on a report whose candidates have all been seen before.
 */
export function useDiscoverProbeSweep({
  candidates,
  enabled,
}: UseDiscoverProbeSweepOptions) {
  const queryClient = useQueryClient()
  const [job, setJob] = useState<DiscoverProbeJob | null>(null)

  /**
   * Handles this hook has already asked the server about.
   *
   * The server also dedupes, but without this the effect would re-POST on every
   * render that changes `candidates` — which sorting, filtering and each
   * progress-driven refetch all do.
   */
  const requestedRef = useRef<string>("")

  const refreshReports = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["discoverReport"] })
  }, [queryClient])

  const start = useCallback(async (handles: string[]) => {
    if (handles.length === 0) return
    const started = await api.startDiscoverProbe(handles)
    // `null` means every handle already had a verdict: nothing to show.
    if (started) setJob(started)
  }, [])

  // Pick up a sweep that was already running — e.g. the page was reloaded, or
  // another tab started one. Without this the progress bar would vanish while
  // the sweep carried on writing verdicts.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void api.getActiveDiscoverProbe().then((active) => {
      if (!cancelled && active) setJob(active)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  // Auto-start for handles never asked about before.
  useEffect(() => {
    if (!enabled || candidates.length === 0) return
    const unprobed = candidates
      .filter((candidate) => !candidate.probe)
      .map((candidate) => candidate.name)
    if (unprobed.length === 0) return

    const signature = unprobed.join(",")
    if (signature === requestedRef.current) return
    requestedRef.current = signature
    void start(unprobed)
  }, [enabled, candidates, start])

  // Poll while a sweep is in flight, refetching the report as verdicts land so
  // rows resolve progressively instead of all at the end.
  useEffect(() => {
    if (!job || TERMINAL_STATUSES.has(job.status)) return
    const timer = setInterval(() => {
      void api
        .getDiscoverProbeStatus(job.probeJobId)
        .then((next) => {
          setJob(next)
          if (next.completed !== job.completed) refreshReports()
          if (TERMINAL_STATUSES.has(next.status)) refreshReports()
        })
        .catch(() => {
          // The job is in-memory: a restart drops it. Stop tracking rather than
          // polling a 404 forever — verdicts already written are safe in the DB.
          setJob(null)
        })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [job, refreshReports])

  const cancel = useCallback(async () => {
    if (!job) return
    setJob(await api.cancelDiscoverProbe(job.probeJobId))
  }, [job])

  /**
   * Re-probe handles whose verdict is wrong or stale.
   *
   * Clears the request signature so the auto-start effect will pick these up
   * again if the recheck itself finds nothing to do.
   */
  const recheck = useMutation({
    mutationFn: (handles: string[]) => api.recheckDiscoverProbes(handles),
    onSuccess: (result) => {
      requestedRef.current = ""
      if (result.job) setJob(result.job)
      refreshReports()
      void queryClient.invalidateQueries({ queryKey: queryKeys.discoverProbes })
    },
  })

  const isRunning = job !== null && !TERMINAL_STATUSES.has(job.status)

  return {
    job,
    isRunning,
    cancel,
    recheck: (handles: string[]) => recheck.mutate(handles),
    isRecheckPending: recheck.isPending,
  }
}
