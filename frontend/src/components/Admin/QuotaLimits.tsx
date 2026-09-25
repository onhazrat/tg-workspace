import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import {
  quotaLiftQuotaCeiling,
  quotaReadQuotaLimits,
  quotaReadQuotaUsage,
  quotaSetQuotaDefaults,
  quotaSetQuotaLimitsForUser,
  usersReadUsers,
} from "@/client"
import { queryKeys } from "@/hooks/queryKeys"
import {
  QuotaLimitsCard,
  QuotaLimitsError,
  QuotaLimitsLoading,
} from "./QuotaLimitsParts"
import {
  budgetsFrom,
  type Draft,
  draftFrom,
  overrideDraftFor,
} from "./quota-limits-model"

/**
 * Budget defaults, per-account overrides, and the early lift (ticket 24).
 *
 * Three things on one card because they are three answers to one question an
 * Admin arrives with — "why is this account not syncing" — and splitting them
 * across screens means reading a limit here and lifting it there.
 *
 * **An empty box means inherit, not zero.** That is the whole of the
 * three-layer resolution on the wire: `null` clears the level and falls back to
 * the one beneath, and zero is a real limit (zero allowance = always low
 * priority; zero ceiling = blocked). A control that could not tell those apart
 * would be unable to express either — which is why the boxes below are seeded
 * from `storedDefaults` and show the *resolved* number as placeholder text.
 * Seeding them from the resolved numbers instead looks identical and quietly
 * writes all six into the settings row on the first save, killing
 * `QUOTA_DEFAULT_*` in `.env` for that deployment for ever.
 */
export default function QuotaLimits() {
  const queryClient = useQueryClient()
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.quotaLimits(),
    queryFn: () => quotaReadQuotaLimits(),
  })

  // Today's ledger, for the lift buttons: an Admin lifting a ceiling wants to
  // see what an account has actually spent, and the limits response
  // deliberately holds no spend — a limit is not a day.
  const today = new Date().toISOString().slice(0, 10)
  const { data: usage } = useQuery({
    queryKey: queryKeys.quotaUsage(today),
    queryFn: () => quotaReadQuotaUsage({ query: {} }),
  })

  // Every account, not only the ones with a ledger row. An account blocked by a
  // ceiling of zero has spent nothing and has no row, so a lift table driven by
  // the ledger could not reach exactly the case the ceiling exists for.
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersReadUsers({ query: { skip: 0, limit: 100 } }),
  })

  const [defaultsDraft, setDefaultsDraft] = useState<Draft>({})
  const [overrideUser, setOverrideUser] = useState("")
  const [overrideDraft, setOverrideDraft] = useState<Draft>({})

  // Seeded from `storedDefaults`, not `defaults`: see the module comment.
  useEffect(() => {
    if (data) setDefaultsDraft(draftFrom(data.storedDefaults ?? []))
  }, [data])

  // Re-seeded whenever the selected account changes, from that account's own
  // rows — otherwise picking a second account shows the first one's numbers and
  // saving copies them across.
  useEffect(() => {
    setOverrideDraft(overrideDraftFor(data?.overrides, overrideUser))
  }, [data, overrideUser])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.quotaLimits() })
    queryClient.invalidateQueries({ queryKey: queryKeys.myQuota() })
    queryClient.invalidateQueries({ queryKey: queryKeys.quotaUsage(today) })
  }

  const saveDefaults = useMutation({
    mutationFn: () =>
      quotaSetQuotaDefaults({ body: { budgets: budgetsFrom(defaultsDraft) } }),
    onSuccess: invalidate,
  })

  const saveOverride = useMutation({
    mutationFn: () =>
      quotaSetQuotaLimitsForUser({
        path: { user_id: overrideUser },
        body: { budgets: budgetsFrom(overrideDraft) },
      }),
    onSuccess: invalidate,
  })

  const clearOverride = useMutation({
    mutationFn: (row: { userId: string; budget: string }) =>
      quotaSetQuotaLimitsForUser({
        path: { user_id: row.userId },
        body: {
          budgets: [{ budget: row.budget, allowance: null, ceiling: null }],
        },
      }),
    onSuccess: invalidate,
  })

  const lift = useMutation({
    mutationFn: (userId: string) =>
      quotaLiftQuotaCeiling({
        path: { user_id: userId },
        // No budgets named: all three, which is what unblocking somebody in a
        // hurry means. The lift expires at the daily reset either way.
        body: { budgets: [], lifted: true },
      }),
    onSuccess: invalidate,
  })

  if (isPending) return <QuotaLimitsLoading />
  if (isError) return <QuotaLimitsError />

  return (
    <QuotaLimitsCard
      limits={data}
      users={users}
      usage={usage}
      defaultsDraft={defaultsDraft}
      setDefaultsDraft={setDefaultsDraft}
      savingDefaults={saveDefaults.isPending}
      onSaveDefaults={() => saveDefaults.mutate()}
      overrideUser={overrideUser}
      onOverrideUserChange={setOverrideUser}
      overrideDraft={overrideDraft}
      setOverrideDraft={setOverrideDraft}
      savingOverride={saveOverride.isPending}
      onSaveOverride={() => saveOverride.mutate()}
      onClearOverride={(row) => clearOverride.mutate(row)}
      lifting={lift.isPending}
      onLift={(userId) => lift.mutate(userId)}
    />
  )
}
