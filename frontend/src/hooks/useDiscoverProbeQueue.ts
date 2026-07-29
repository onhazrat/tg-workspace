import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { api, type DiscoverProbeQueue } from "@/api"
import { queryKeys } from "@/hooks/queryKeys"

/**
 * How often to re-read the queue while it is draining.
 *
 * Slower than the old sweep's 1.5s because it no longer drives anything — the
 * server probes at its own pace regardless, so this only sets how promptly
 * resolved rows appear.
 */
const POLL_INTERVAL_MS = 4000

/**
 * Whether the queue is worth polling.
 *
 * Deliberately ignores `retrying`. Those handles come due on a 15-minute to
 * 24-hour backoff and a permanently unreachable one retries forever, so keying
 * the poll off them would mean polling for the life of the tab to observe
 * something that changes a few times a day.
 */
export function shouldPollProbeQueue(queue?: DiscoverProbeQueue): boolean {
  if (!queue) return false
  return queue.enabled && (queue.queued > 0 || queue.running)
}

/**
 * Reads the server-side handle-probe queue, and nothing else (D9).
 *
 * ## What this deliberately does not do
 *
 * It does not decide which handles get probed, when a sweep starts, or how
 * batches follow one another. All of that used to live in a React effect here,
 * which is why this hook's predecessor accumulated a dedupe ref, a stop latch
 * and a batch-chaining fix — and still could not survive its own tab being
 * closed, stranding every candidate past the first batch. `create_report`
 * enqueues server-side and a scheduled job drains the queue, so there is nothing
 * left here to get wrong.
 *
 * What remains is a read, a refetch trigger, and two operator actions.
 */
export function useDiscoverProbeQueue({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.discoverProbeQueue,
    queryFn: api.getDiscoverProbeQueue,
    enabled,
    refetchInterval: (q) =>
      shouldPollProbeQueue(q.state.data) ? POLL_INTERVAL_MS : false,
  })

  const queue = query.data
  const checked = queue ? queue.resolved + queue.unavailable : 0
  const lastChecked = useRef(checked)

  // Pull the report back in when new verdicts have landed, so rows resolve
  // progressively instead of all at once whenever something else happens to
  // refetch. This is cache invalidation keyed on a value change, not
  // orchestration: it never decides what the server should do next.
  useEffect(() => {
    if (checked === lastChecked.current) return
    lastChecked.current = checked
    void queryClient.invalidateQueries({ queryKey: ["discoverReport"] })
  }, [checked, queryClient])

  const refreshQueue = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.discoverProbeQueue })

  const recheck = useMutation({
    mutationFn: (handles: string[]) => api.recheckDiscoverProbes(handles),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["discoverReport"] })
      void refreshQueue()
    },
  })

  /**
   * Pause or resume probing.
   *
   * The ordinary scheduler-job toggle rather than anything Discover-specific, so
   * it is durable across reloads and honoured by every open tab. The old Stop
   * button was a ref in one component instance: a second tab carried on probing,
   * and a reload undid it.
   */
  const setPaused = useMutation({
    mutationFn: (paused: boolean) => api.updateJob("discover_probe", !paused),
    onSuccess: () => void refreshQueue(),
  })

  return {
    queue,
    isDraining: shouldPollProbeQueue(queue),
    recheck: (handles: string[]) => recheck.mutate(handles),
    isRecheckPending: recheck.isPending,
    setPaused: (paused: boolean) => setPaused.mutate(paused),
    isPausePending: setPaused.isPending,
  }
}
