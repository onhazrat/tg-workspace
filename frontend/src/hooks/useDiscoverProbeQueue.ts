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
export const DRAINING_POLL_INTERVAL_MS = 4000

/**
 * How often to re-read the queue while nothing is draining (ticket 04).
 *
 * Five minutes rather than four seconds because of what is on screen in this
 * state: a day's and a week's Request spend, which moves a few times an hour at
 * most, and which nobody is watching tick. The argument the drain predicate
 * makes against polling for `retrying` — do not poll for the life of a tab to
 * observe something that changes a few times a day — applies here in full, and
 * is why this cadence is slow rather than why there is no cadence at all.
 */
export const IDLE_POLL_INTERVAL_MS = 5 * 60 * 1000

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
 * The cadence to re-read the queue on, or `false` to stop.
 *
 * Wraps `shouldPollProbeQueue` rather than replacing it, because that predicate
 * still answers the question it was written for and that answer is still right:
 * it says whether there is work in flight. What changed in ticket 04 is that
 * "is there work in flight" stopped being the same question as "is anything on
 * this bar still worth refreshing". For an account that may manage jobs the bar
 * now carries a spend total and stays on screen through the idle stretch, so a
 * queue that has stopped draining still has a figure going stale on it.
 *
 * `canManageJobs` is in here and not only in the component so the idle poll
 * follows what is actually rendered. Everyone else sees nothing on an idle
 * queue, and a request for a number nobody is shown is a request worth not
 * making.
 */
export function probeQueueRefetchInterval(
  queue: DiscoverProbeQueue | undefined,
  canManageJobs: boolean,
): number | false {
  if (!queue) return false
  if (shouldPollProbeQueue(queue)) return DRAINING_POLL_INTERVAL_MS
  return canManageJobs ? IDLE_POLL_INTERVAL_MS : false
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
export function useDiscoverProbeQueue({
  enabled,
  canManageJobs,
}: {
  enabled: boolean
  /**
   * Whether the caller's bar keeps anything on screen once the queue is idle.
   * Passed in rather than resolved here so this hook stays a read of the queue.
   */
  canManageJobs: boolean
}) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.discoverProbeQueue,
    queryFn: api.getDiscoverProbeQueue,
    enabled,
    refetchInterval: (q) =>
      probeQueueRefetchInterval(q.state.data, canManageJobs),
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
