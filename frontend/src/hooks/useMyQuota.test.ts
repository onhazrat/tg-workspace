/**
 * The words the usage table puts on a Budget.
 *
 * The one that matters is zero: an allowance of 0 is "always best-effort" and a
 * ceiling of 0 is "never runs", so rendering either as "no limit" tells an
 * account it is unlimited when it is the opposite.
 */
import { describe, expect, test } from "bun:test"
import type { MyBudgetUsage } from "@/client"
import { budgetRow } from "./useMyQuota"

const usage = (over: Partial<MyBudgetUsage> = {}): MyBudgetUsage => ({
  budget: "auto_sync",
  allowance: 100,
  ceiling: 500,
  spent: 7,
  status: "normal",
  lifted: false,
  ...over,
})

describe("budgetRow", () => {
  test("names the Budget and prints its numbers", () => {
    expect(budgetRow(usage())).toEqual({
      label: "Scheduled syncing",
      spent: 7,
      allowance: "100",
      ceiling: "500",
      status: "Normal priority",
    })
  })

  test("null is unlimited, and zero is a limit", () => {
    const row = budgetRow(usage({ allowance: null, ceiling: 0 }))
    expect(row.allowance).toBe("no limit")
    expect(row.ceiling).toBe("0")
    expect(budgetRow(usage({ allowance: undefined })).allowance).toBe(
      "no limit",
    )
  })

  test("each status the server computes reads as what will happen", () => {
    expect(budgetRow(usage({ status: "degraded" })).status).toBe("Low priority")
    expect(budgetRow(usage({ status: "blocked" })).status).toBe(
      "Paused until UTC midnight",
    )
  })

  test("a status this client does not know is shown as sent", () => {
    expect(budgetRow(usage({ status: "throttled" })).status).toBe("throttled")
  })

  test("a lifted ceiling says so after the status", () => {
    expect(budgetRow(usage({ lifted: true })).status).toBe(
      "Normal priority (limit lifted today)",
    )
  })
})
