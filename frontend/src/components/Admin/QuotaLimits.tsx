import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import {
  type BudgetLimitsPayload,
  quotaLiftQuotaCeiling,
  quotaReadQuotaLimits,
  quotaReadQuotaUsage,
  quotaSetQuotaDefaults,
  quotaSetQuotaLimitsForUser,
  usersReadUsers,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { queryKeys } from "@/hooks/queryKeys"
import { budgetLabel } from "@/hooks/useMyQuota"

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
const BUDGETS = ["auto_sync", "manual_bulk", "manual_single"] as const

/** `""` → null (inherit); anything else → the number, zero included. */
function parseLimit(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? Math.trunc(value) : null
}

function showLimit(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value)
}

/** What the level underneath resolves to, for placeholder text. */
function inheritedText(value: number | null | undefined): string {
  return value === null || value === undefined ? "no limit" : String(value)
}

type Draft = Record<string, { allowance: string; ceiling: string }>

function draftFrom(rows: BudgetLimitsPayload[]): Draft {
  const draft: Draft = {}
  for (const budget of BUDGETS) {
    const row = rows.find((d) => d.budget === budget)
    draft[budget] = {
      allowance: showLimit(row?.allowance),
      ceiling: showLimit(row?.ceiling),
    }
  }
  return draft
}

function LimitInputs({
  budget,
  draft,
  setDraft,
  placeholders,
}: {
  budget: string
  draft: Draft
  setDraft: (updater: (prev: Draft) => Draft) => void
  placeholders: BudgetLimitsPayload | undefined
}) {
  const update = (field: "allowance" | "ceiling", value: string) =>
    setDraft((prev) => ({
      ...prev,
      [budget]: {
        allowance: prev[budget]?.allowance ?? "",
        ceiling: prev[budget]?.ceiling ?? "",
        [field]: value,
      },
    }))

  return (
    <>
      <TableCell>
        <Input
          type="number"
          className="w-32"
          aria-label={`${budgetLabel(budget)} allowance`}
          placeholder={inheritedText(placeholders?.allowance)}
          value={draft[budget]?.allowance ?? ""}
          onChange={(event) => update("allowance", event.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          className="w-32"
          aria-label={`${budgetLabel(budget)} limit`}
          placeholder={inheritedText(placeholders?.ceiling)}
          value={draft[budget]?.ceiling ?? ""}
          onChange={(event) => update("ceiling", event.target.value)}
        />
      </TableCell>
    </>
  )
}

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
    const rows = (data?.overrides ?? [])
      .filter((row) => row.userId === overrideUser)
      .map((row) => ({
        budget: row.budget,
        allowance: row.allowance,
        ceiling: row.ceiling,
      }))
    setOverrideDraft(draftFrom(rows))
  }, [data, overrideUser])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.quotaLimits() })
    queryClient.invalidateQueries({ queryKey: queryKeys.myQuota() })
    queryClient.invalidateQueries({ queryKey: queryKeys.quotaUsage(today) })
  }

  const budgetsFrom = (draft: Draft) =>
    BUDGETS.map((budget) => ({
      budget,
      allowance: parseLimit(draft[budget]?.allowance ?? ""),
      ceiling: parseLimit(draft[budget]?.ceiling ?? ""),
    }))

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

  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Request budgets</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Request budgets</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Budgets could not be loaded.
          </p>
        </CardContent>
      </Card>
    )
  }

  const resolved = data?.defaults ?? []
  const overrides = data?.overrides ?? []
  const accounts = users?.data ?? []
  const spentByAccount = new Map(
    (usage?.entries ?? []).map((entry) => [entry.userId, entry]),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request budgets</CardTitle>
        <CardDescription>
          Past the allowance an account's work on that budget drops to low
          priority; past the limit it stops until the daily reset at UTC
          midnight. An empty box inherits the value shown in grey. Zero
          allowance means always low priority; zero limit blocks outright.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div>
          <h3 className="mb-2 font-medium text-sm">Deployment defaults</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Budget</TableHead>
                <TableHead>Allowance</TableHead>
                <TableHead>Limit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {BUDGETS.map((budget) => (
                <TableRow key={budget}>
                  <TableCell className="font-medium">
                    {budgetLabel(budget)}
                  </TableCell>
                  <LimitInputs
                    budget={budget}
                    draft={defaultsDraft}
                    setDraft={setDefaultsDraft}
                    placeholders={resolved.find((r) => r.budget === budget)}
                  />
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button
            className="mt-3"
            disabled={saveDefaults.isPending}
            onClick={() => saveDefaults.mutate()}
          >
            {saveDefaults.isPending ? "Saving…" : "Save defaults"}
          </Button>
        </div>

        <div>
          <h3 className="mb-2 font-medium text-sm">Override one account</h3>
          <select
            className="mb-3 h-9 w-72 rounded-md border bg-background px-2 text-sm"
            aria-label="Account to override"
            value={overrideUser}
            onChange={(event) => setOverrideUser(event.target.value)}
          >
            <option value="">Select an account…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.email}
              </option>
            ))}
          </select>
          {overrideUser === "" ? null : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Budget</TableHead>
                    <TableHead>Allowance</TableHead>
                    <TableHead>Limit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {BUDGETS.map((budget) => (
                    <TableRow key={budget}>
                      <TableCell className="font-medium">
                        {budgetLabel(budget)}
                      </TableCell>
                      <LimitInputs
                        budget={budget}
                        draft={overrideDraft}
                        setDraft={setOverrideDraft}
                        placeholders={resolved.find((r) => r.budget === budget)}
                      />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button
                className="mt-3"
                disabled={saveOverride.isPending}
                onClick={() => saveOverride.mutate()}
              >
                {saveOverride.isPending ? "Saving…" : "Save override"}
              </Button>
            </>
          )}
        </div>

        <div>
          <h3 className="mb-2 font-medium text-sm">Existing overrides</h3>
          {overrides.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No account overrides the defaults.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead className="text-right">Allowance</TableHead>
                  <TableHead className="text-right">Limit</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {overrides.map((row) => (
                  <TableRow key={`${row.userId}-${row.budget}`}>
                    <TableCell className="font-medium">{row.email}</TableCell>
                    <TableCell>{budgetLabel(row.budget)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {showLimit(row.allowance) || "inherits"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {showLimit(row.ceiling) || "inherits"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          clearOverride.mutate({
                            userId: row.userId,
                            budget: row.budget,
                          })
                        }
                      >
                        Clear
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div>
          <h3 className="mb-2 font-medium text-sm">Lift today's limits</h3>
          {accounts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No accounts.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Spent today</TableHead>
                  <TableHead>Lifted</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => {
                  const entry = spentByAccount.get(account.id)
                  const lifted = [
                    entry?.autoSyncLifted ? "scheduled" : null,
                    entry?.manualBulkLifted ? "bulk" : null,
                    entry?.manualSingleLifted ? "single" : null,
                  ].filter(Boolean)
                  return (
                    <TableRow key={account.id}>
                      <TableCell className="font-medium">
                        {account.email}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {entry?.total ?? 0}
                      </TableCell>
                      <TableCell>{lifted.join(", ") || "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={lift.isPending}
                          onClick={() => lift.mutate(account.id)}
                        >
                          Lift until midnight
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
