import { useQuery } from "@tanstack/react-query"

import { api } from "@/api"
import { queryKeys } from "@/hooks/queryKeys"

/**
 * Whether this account may manage the scheduler — `Permission.JOBS_MANAGE`.
 *
 * ## Why a request rather than a claim on the token
 *
 * The server publishes nobody's permission set. `/users/me` answers a
 * `UserPublic`, which carries no roles and no permissions, and the JWT carries
 * a subject and nothing else — so there is no fact on this machine that
 * answers the question, and asking the server is not a shortcut past one.
 *
 * `GET /jobs/status` is the reading of that permission, not a proxy for it:
 * `app/api/routes/jobs.py` gates it on the very same `JOBS_MANAGE` that gates
 * the pause toggle this guards. An answer means the account holds it; a 403
 * means it does not. Nothing new is mounted to find that out, which the ticket
 * asks for, and the deployment's own definition of the permission stays the
 * only one — a `permissions` array on `/users/me` would be a second answer to
 * "can this account do X", and two answers is how authorisation rots.
 *
 * **Never read `is_superuser` for this.** It is the other second answer, it
 * disagrees with the roles table the moment a fourth role exists, and
 * `tests/api/test_permission_checks.py` refuses it server-side for exactly that
 * reason. That the check is unenforceable from here is not a licence.
 *
 * `retry: false` because a 403 is the answer, not a failure to get one, and
 * `staleTime: Infinity` because a role assignment does not change under a
 * session. Absent while the read is in flight, so a gated surface stays hidden
 * rather than flashing into view and back out.
 */
// ponytail: one gated read stands in for the permission, which costs an
// ordinary account a single 403 per session and answers exactly one permission.
// If a second surface needs a second permission, publish the caller's set on
// `/users/me` from `rbac.permissions_for` and read that instead — one request,
// still one source of truth. Not worth it for one caller.
export function useCanManageJobs(): boolean {
  const { isSuccess } = useQuery({
    queryKey: queryKeys.jobsStatus,
    queryFn: api.jobsStatus,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return isSuccess
}
