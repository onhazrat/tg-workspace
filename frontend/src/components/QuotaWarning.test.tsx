/**
 * The out-of-Requests banner. What is pinned: nothing shows while every Budget
 * is normal, blocked outranks degraded and names only the blocked Budgets, and
 * each state quotes the limit that applies to it (the ceiling when blocked, the
 * allowance when degraded, infinity when none is set).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"

import type { MyBudgetUsage } from "@/client"
import { QuotaWarningAlert } from "./QuotaWarning"

afterEach(cleanup)

const budget = (over: Partial<MyBudgetUsage>): MyBudgetUsage => ({
  budget: "auto_sync",
  spent: 10,
  status: "normal",
  ...over,
})

describe("QuotaWarningAlert", () => {
  test("nothing while every Budget is normal", () => {
    const { container } = render(<QuotaWarningAlert budgets={[budget({})]} />)
    expect(container.innerHTML).toBe("")
  })

  test("degraded quotes the allowance, or infinity", () => {
    render(
      <QuotaWarningAlert
        budgets={[
          budget({ status: "degraded", allowance: 5 }),
          budget({ budget: "manual_bulk", status: "degraded" }),
        ]}
      />,
    )
    const alert = screen.getByTestId("quota-warning")
    expect(alert.textContent).toContain(
      "Running at low priority: Scheduled syncing, Bulk actions",
    )
    expect(alert.textContent).toContain("Scheduled syncing: 10 of 5 requests")
    expect(alert.textContent).toContain("Bulk actions: 10 of ∞ requests")
  })

  test("blocked outranks degraded and quotes the ceiling", () => {
    render(
      <QuotaWarningAlert
        budgets={[
          budget({ status: "degraded", allowance: 5, ceiling: 50 }),
          budget({ budget: "manual_single", status: "blocked", ceiling: 20 }),
        ]}
      />,
    )
    const alert = screen.getByTestId("quota-warning")
    expect(alert.textContent).toContain(
      "Daily request limit reached: Single-channel syncs",
    )
    expect(alert.textContent).not.toContain("Scheduled syncing")
    expect(alert.textContent).toContain("Single-channel syncs: 10 of 20")
  })
})
