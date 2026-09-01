import { useQuery } from "@tanstack/react-query"

import { type MyBudgetUsage, quotaReadMyQuota } from "@/client"
import { queryKeys } from "./queryKeys"

/**
 * The signed-in account's three Budgets (ticket 24).
 *
 * One query behind both the banner and the settings panel, so the two cannot
 * disagree about whether this account is out of Requests.
 *
 * Refetched on an interval, and that is not decoration: the spend changes
 * without the browser doing anything — the scheduler syncs, and the ceiling
 * lifts at UTC midnight — so a banner fetched once at mount would still be
 * telling somebody they are blocked hours after an Admin lifted them. Sixty
 * seconds is the same order as the app's other background polls and the payload
 * is three rows.
 */
const REFRESH_MS = 60_000

export function useMyQuota() {
  return useQuery({
    queryKey: queryKeys.myQuota(),
    queryFn: () => quotaReadMyQuota(),
    refetchInterval: REFRESH_MS,
    // A signed-out or unapproved browser gets a 401/403 here, and retrying it
    // three times per mount adds nothing but noise to the console.
    retry: false,
  })
}

/** Human wording for a Budget, so the three names are spelled in one place. */
export const BUDGET_LABELS: Record<string, string> = {
  auto_sync: "Scheduled syncing",
  manual_bulk: "Bulk actions",
  manual_single: "Single-channel syncs",
}

export function budgetLabel(budget: string): string {
  return BUDGET_LABELS[budget] ?? budget
}

/**
 * The Budgets that have run out, worst first.
 *
 * `blocked` before `degraded` because a banner has room for one sentence and
 * "nothing is running" is the one somebody needs to read. The server decides
 * which state a Budget is in; this only orders them.
 */
export function exhaustedBudgets(budgets: MyBudgetUsage[]): MyBudgetUsage[] {
  const rank = (status: string) => (status === "blocked" ? 0 : 1)
  return budgets
    .filter((b) => b.status === "blocked" || b.status === "degraded")
    .sort((a, b) => rank(a.status ?? "normal") - rank(b.status ?? "normal"))
}
