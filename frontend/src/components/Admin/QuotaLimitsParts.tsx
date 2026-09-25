import type { ReactNode } from "react"

import type {
  BudgetLimitsPayload,
  QuotaLimitOverride,
  QuotaLimitsResponse,
  QuotaUsageResponse,
  UsersPublic,
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
import { budgetLabel } from "@/hooks/useMyQuota"
import {
  BUDGETS,
  type Draft,
  draftValue,
  inheritedText,
  type LimitField,
  liftedText,
  showLimit,
  withLimit,
} from "./quota-limits-model"

/** The props-only pieces of `QuotaLimits`; the shell keeps the queries. */

type SetDraft = (updater: (prev: Draft) => Draft) => void

function LimitInputs({
  budget,
  draft,
  setDraft,
  placeholders,
}: {
  budget: string
  draft: Draft
  setDraft: SetDraft
  placeholders: BudgetLimitsPayload | undefined
}) {
  const update = (field: LimitField, value: string) =>
    setDraft((prev) => withLimit(prev, budget, field, value))

  return (
    <>
      <TableCell>
        <Input
          type="number"
          className="w-32"
          aria-label={`${budgetLabel(budget)} allowance`}
          placeholder={inheritedText(placeholders?.allowance)}
          value={draftValue(draft, budget, "allowance")}
          onChange={(event) => update("allowance", event.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          className="w-32"
          aria-label={`${budgetLabel(budget)} limit`}
          placeholder={inheritedText(placeholders?.ceiling)}
          value={draftValue(draft, budget, "ceiling")}
          onChange={(event) => update("ceiling", event.target.value)}
        />
      </TableCell>
    </>
  )
}

function BudgetLimitsTable({
  draft,
  setDraft,
  resolved,
}: {
  draft: Draft
  setDraft: SetDraft
  resolved: BudgetLimitsPayload[]
}) {
  return (
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
            <TableCell className="font-medium">{budgetLabel(budget)}</TableCell>
            <LimitInputs
              budget={budget}
              draft={draft}
              setDraft={setDraft}
              placeholders={resolved.find((r) => r.budget === budget)}
            />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SaveButton({
  pending,
  label,
  onClick,
}: {
  pending: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button className="mt-3" disabled={pending} onClick={onClick}>
      {pending ? "Saving…" : label}
    </Button>
  )
}

function StatusCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Request budgets</CardTitle>
      </CardHeader>
      {children}
    </Card>
  )
}

export function QuotaLimitsLoading() {
  return (
    <StatusCard>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </CardContent>
    </StatusCard>
  )
}

export function QuotaLimitsError() {
  return (
    <StatusCard>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          Budgets could not be loaded.
        </p>
      </CardContent>
    </StatusCard>
  )
}

function OverridesSection({
  overrides,
  onClear,
}: {
  overrides: QuotaLimitOverride[]
  onClear: (row: { userId: string; budget: string }) => void
}) {
  if (overrides.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No account overrides the defaults.
      </p>
    )
  }
  return (
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
                  onClear({ userId: row.userId, budget: row.budget })
                }
              >
                Clear
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function LiftSection({
  accounts,
  usage,
  liftPending,
  onLift,
}: {
  accounts: UsersPublic["data"]
  usage: QuotaUsageResponse | undefined
  liftPending: boolean
  onLift: (userId: string) => void
}) {
  if (accounts.length === 0) {
    return <p className="text-muted-foreground text-sm">No accounts.</p>
  }
  const spentByAccount = new Map(
    (usage?.entries ?? []).map((entry) => [entry.userId, entry]),
  )
  return (
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
          return (
            <TableRow key={account.id}>
              <TableCell className="font-medium">{account.email}</TableCell>
              <TableCell className="text-right tabular-nums">
                {entry?.total ?? 0}
              </TableCell>
              <TableCell>{liftedText(entry)}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={liftPending}
                  onClick={() => onLift(account.id)}
                >
                  Lift until midnight
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export interface QuotaLimitsCardProps {
  limits: QuotaLimitsResponse | undefined
  users: UsersPublic | undefined
  usage: QuotaUsageResponse | undefined
  defaultsDraft: Draft
  setDefaultsDraft: SetDraft
  savingDefaults: boolean
  onSaveDefaults: () => void
  overrideUser: string
  onOverrideUserChange: (userId: string) => void
  overrideDraft: Draft
  setOverrideDraft: SetDraft
  savingOverride: boolean
  onSaveOverride: () => void
  onClearOverride: (row: { userId: string; budget: string }) => void
  lifting: boolean
  onLift: (userId: string) => void
}

export function QuotaLimitsCard(props: QuotaLimitsCardProps) {
  const resolved = props.limits?.defaults ?? []
  const accounts = props.users?.data ?? []
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
          <BudgetLimitsTable
            draft={props.defaultsDraft}
            setDraft={props.setDefaultsDraft}
            resolved={resolved}
          />
          <SaveButton
            pending={props.savingDefaults}
            label="Save defaults"
            onClick={props.onSaveDefaults}
          />
        </div>

        <div>
          <h3 className="mb-2 font-medium text-sm">Override one account</h3>
          <select
            className="mb-3 h-9 w-72 rounded-md border bg-background px-2 text-sm"
            aria-label="Account to override"
            value={props.overrideUser}
            onChange={(event) => props.onOverrideUserChange(event.target.value)}
          >
            <option value="">Select an account…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.email}
              </option>
            ))}
          </select>
          {props.overrideUser === "" ? null : (
            <>
              <BudgetLimitsTable
                draft={props.overrideDraft}
                setDraft={props.setOverrideDraft}
                resolved={resolved}
              />
              <SaveButton
                pending={props.savingOverride}
                label="Save override"
                onClick={props.onSaveOverride}
              />
            </>
          )}
        </div>

        <div>
          <h3 className="mb-2 font-medium text-sm">Existing overrides</h3>
          <OverridesSection
            overrides={props.limits?.overrides ?? []}
            onClear={props.onClearOverride}
          />
        </div>

        <div>
          <h3 className="mb-2 font-medium text-sm">Lift today's limits</h3>
          <LiftSection
            accounts={accounts}
            usage={props.usage}
            liftPending={props.lifting}
            onLift={props.onLift}
          />
        </div>
      </CardContent>
    </Card>
  )
}
