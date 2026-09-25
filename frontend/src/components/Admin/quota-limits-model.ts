/**
 * What the Request budgets card decides, with no React in it. `QuotaLimits.tsx`
 * says why an empty box means inherit and why the defaults are seeded from
 * `storedDefaults`; these functions are where that holds.
 */
import type {
  BudgetLimitsPayload,
  QuotaLimitOverride,
  QuotaUsageEntry,
} from "@/client"

export const BUDGETS = ["auto_sync", "manual_bulk", "manual_single"] as const

export type LimitField = "allowance" | "ceiling"

export type Draft = Record<string, { allowance: string; ceiling: string }>

/** `""` → null (inherit); anything else → the number, zero included. */
export function parseLimit(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? Math.trunc(value) : null
}

export function showLimit(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value)
}

/** What the level underneath resolves to, for placeholder text. */
export function inheritedText(value: number | null | undefined): string {
  return value === null || value === undefined ? "no limit" : String(value)
}

export function draftFrom(rows: BudgetLimitsPayload[]): Draft {
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

/** The draft for one account, from that account's own override rows only. */
export function overrideDraftFor(
  overrides: QuotaLimitOverride[] | undefined,
  userId: string,
): Draft {
  return draftFrom(
    (overrides ?? [])
      .filter((row) => row.userId === userId)
      .map((row) => ({
        budget: row.budget,
        allowance: row.allowance,
        ceiling: row.ceiling,
      })),
  )
}

export function withLimit(
  draft: Draft,
  budget: string,
  field: LimitField,
  value: string,
): Draft {
  return {
    ...draft,
    [budget]: {
      allowance: draft[budget]?.allowance ?? "",
      ceiling: draft[budget]?.ceiling ?? "",
      [field]: value,
    },
  }
}

export function draftValue(
  draft: Draft,
  budget: string,
  field: LimitField,
): string {
  return draft[budget]?.[field] ?? ""
}

/** The request body: all three budgets, an empty box sent as null. */
export function budgetsFrom(draft: Draft): BudgetLimitsPayload[] {
  return BUDGETS.map((budget) => ({
    budget,
    allowance: parseLimit(draftValue(draft, budget, "allowance")),
    ceiling: parseLimit(draftValue(draft, budget, "ceiling")),
  }))
}

/** Which of an account's budgets are lifted today, for the Lifted column. */
export function liftedText(entry: QuotaUsageEntry | undefined): string {
  const lifted = [
    entry?.autoSyncLifted ? "scheduled" : null,
    entry?.manualBulkLifted ? "bulk" : null,
    entry?.manualSingleLifted ? "single" : null,
  ].filter(Boolean)
  return lifted.join(", ") || "—"
}
