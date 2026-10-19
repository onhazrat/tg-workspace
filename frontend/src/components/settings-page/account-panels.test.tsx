/** The Account topic's panels (SET-03), as the views draw them. */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { MyBudgetUsage } from "@/client"
import {
  DeleteAccountView,
  PasswordForm,
  SignedInAs,
  UsageTable,
} from "./account-panels"

afterEach(cleanup)

describe("SignedInAs", () => {
  test("names the Account and signs out", () => {
    const onSignOut = mock(() => {})
    render(<SignedInAs email="ann@x.test" onSignOut={onSignOut} />)
    expect(screen.getByText("ann@x.test")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})

function fillPassword(current: string, next: string, again: string) {
  fireEvent.click(screen.getByRole("button", { name: "Change password" }))
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: current },
  })
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: next },
  })
  fireEvent.change(screen.getByLabelText("New password again"), {
    target: { value: again },
  })
  fireEvent.click(screen.getByRole("button", { name: "Change" }))
}

describe("PasswordForm", () => {
  test("refuses a short password without sending it", () => {
    const onChange = mock(async () => {})
    render(<PasswordForm onChange={onChange} />)
    fillPassword("old-password", "short", "short")
    expect(
      screen.getByText("Password must be at least 8 characters"),
    ).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  test("refuses two different new passwords", () => {
    const onChange = mock(async () => {})
    render(<PasswordForm onChange={onChange} />)
    fillPassword("old-password", "new-password-1", "new-password-2")
    expect(screen.getByText("The passwords don't match")).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  test("sends the current and the new password, and shows a refusal", async () => {
    const onChange = mock(async () => {
      throw new Error("Incorrect password")
    })
    render(<PasswordForm onChange={onChange} />)
    fillPassword("old-password", "new-password", "new-password")
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("old-password", "new-password"),
    )
    await waitFor(() =>
      expect(screen.getByText("Incorrect password")).toBeTruthy(),
    )
  })
})

const budget = (over: Partial<MyBudgetUsage>): MyBudgetUsage =>
  ({
    budget: "auto_sync",
    spent: 12,
    allowance: 100,
    ceiling: null,
    status: "normal",
    lifted: false,
    ...over,
  }) as MyBudgetUsage

describe("UsageTable", () => {
  test("one row per Budget with its allowance, ceiling and status", () => {
    render(
      <UsageTable
        isPending={false}
        budgets={[
          budget({}),
          budget({ budget: "manual_bulk", status: "blocked", lifted: true }),
        ]}
      />,
    )
    const row = screen.getByRole("row", { name: /Scheduled syncing/ })
    expect(row.textContent).toContain("12")
    expect(row.textContent).toContain("no limit")
    expect(row.textContent).toContain("Normal priority")
    expect(
      screen.getByRole("row", { name: /Bulk actions/ }).textContent,
    ).toContain("Paused until UTC midnight (limit lifted today)")
  })
})

describe("DeleteAccountView", () => {
  test("asks what goes with the Account before deleting it", async () => {
    const onDelete = mock(async () => {})
    render(<DeleteAccountView canDelete onDelete={onDelete} />)
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }))
    expect(screen.getByRole("dialog").textContent).toContain("follows")
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
  })

  test("an Account that cannot delete itself is told so", () => {
    render(<DeleteAccountView canDelete={false} onDelete={async () => {}} />)
    expect(screen.queryByRole("button", { name: "Delete my account" })).toBe(
      null,
    )
    expect(screen.getByText(/cannot delete its own account/)).toBeTruthy()
  })
})
