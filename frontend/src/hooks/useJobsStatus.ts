import { type UseQueryResult, useQuery } from "@tanstack/react-query"

import { api } from "@/api"
import type { JobStatusEntry } from "@/api/jobs"
import { queryKeys } from "@/hooks/queryKeys"

/** How often the scheduler's status is re-read. Was `App`'s `setInterval`. */
const JOBS_STATUS_POLL_MS = 30_000

/**
 * The scheduler's job status, read once for everybody who wants it.
 *
 * `App` polled this on a bare `setInterval` for the auto-sync pause banner
 * while `useCanManageJobs` ran a second, separate read of the same route, which
 * is two requests for one fact and two different answers to "is it stale".
 * Server state is TanStack Query here (CLAUDE.md), and this is that rule applied
 * to the last effect that was ignoring it.
 *
 * `retry: false` because a **403 is the answer**, not a failure to get one:
 * `/jobs/status` is gated on `JOBS_MANAGE`, so an account without it gets an
 * error response and that error *is* the permission read. Retrying would just
 * ask three times.
 *
 * The poll is what makes that safe. A single non-retried read would pin an
 * account to "cannot manage" for the life of the tab after one backend restart,
 * with no window-focus event to rescue it because the operator never left the
 * tab. Re-asking every 30s, which this route was already being asked anyway,
 * means a transient failure costs one interval rather than the session.
 */
export function useJobsStatusQuery(): UseQueryResult<
  Record<string, JobStatusEntry>
> {
  return useQuery({
    queryKey: queryKeys.jobsStatus,
    queryFn: api.jobsStatus,
    retry: false,
    refetchInterval: JOBS_STATUS_POLL_MS,
    refetchOnWindowFocus: false,
  })
}

/**
 * Whether this account may manage the scheduler — `Permission.JOBS_MANAGE`.
 *
 * ## Why a request rather than a claim on the token
 *
 * The server publishes nobody's permission set. `/users/me` answers a
 * `UserPublic`, which carries no roles and no permissions, and the JWT carries a
 * subject and nothing else, so there is no fact on this machine that answers the
 * question. `GET /jobs/status` is the reading of the permission rather than a
 * proxy for it: `app/api/routes/jobs.py` gates it on the very same
 * `JOBS_MANAGE` that gates the pause toggle this guards, so an answer means the
 * account holds it and a 403 means it does not. The deployment's own definition
 * stays the only one — a `permissions` array on `/users/me` would be a second
 * answer to "can this account do X", and two answers is how authorisation rots.
 *
 * **Never read `is_superuser` for this.** It is the other second answer, it
 * disagrees with the roles table the moment a fourth role exists, and
 * `tests/api/test_permission_checks.py` refuses it server-side for that reason.
 * That the check is unenforceable from here is not a licence.
 *
 * Absent while the first read is in flight, so a gated surface stays hidden
 * rather than flashing into view and back out.
 */
// ponytail: one already-polled read stands in for the permission, and answers
// exactly one. If a second surface needs a different permission, publish the
// caller's set on `/users/me` from `rbac.permissions_for` and read that instead
// — still one request, still one source of truth. Not worth it for one caller.
export function useCanManageJobs(): boolean {
  return useJobsStatusQuery().isSuccess
}
