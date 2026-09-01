import { AlertTriangle, Ban } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { budgetLabel, exhaustedBudgets, useMyQuota } from "@/hooks/useMyQuota"

/**
 * The persistent warning a User sees when a Budget runs out (ticket 24).
 *
 * **Persistent, not a toast.** Running out lasts until UTC midnight or until an
 * Admin lifts it, and a toast is gone before the next click — which would leave
 * somebody clicking Sync repeatedly on an app that looks like it is failing at
 * random. It sits in the shell above the page so it is visible from wherever
 * the sync was started, and it is deliberately not dismissible: dismissing it
 * would hide the only explanation for what the app is doing.
 *
 * **Two states, told apart.** Degraded means the work is still running, behind
 * everyone else's; blocked means it is not running at all. Reporting them alike
 * would make ticket 23's ladder — which is a priority, not a failure — read as
 * an outage. `status` comes from the server for exactly this reason: the
 * derivation is three comparisons in which zero means opposite things on the
 * two rungs.
 */
export default function QuotaWarning() {
  const { data } = useMyQuota()
  const exhausted = exhaustedBudgets(data?.budgets ?? [])

  if (exhausted.length === 0) return null

  const blocked = exhausted.filter((b) => b.status === "blocked")
  const isBlocked = blocked.length > 0
  const shown = isBlocked ? blocked : exhausted
  const names = shown.map((b) => budgetLabel(b.budget)).join(", ")

  return (
    <Alert
      variant={isBlocked ? "destructive" : "default"}
      className="mb-4"
      data-testid="quota-warning"
    >
      {isBlocked ? <Ban /> : <AlertTriangle />}
      <AlertTitle>
        {isBlocked
          ? `Daily request limit reached: ${names}`
          : `Running at low priority: ${names}`}
      </AlertTitle>
      <AlertDescription>
        {isBlocked
          ? "New syncing on these is paused until the daily reset at UTC midnight. An admin can lift the limit sooner."
          : "These have used their daily allowance, so their work now runs only when nothing else is queued. Nothing is lost — it is slower."}{" "}
        {shown.map((budget) => (
          <span key={budget.budget} className="block tabular-nums">
            {budgetLabel(budget.budget)}: {budget.spent} of{" "}
            {isBlocked ? (budget.ceiling ?? "∞") : (budget.allowance ?? "∞")}{" "}
            requests
          </span>
        ))}
      </AlertDescription>
    </Alert>
  )
}
