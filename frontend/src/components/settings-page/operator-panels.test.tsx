/**
 * The Operator topic (SET-03), props only: users with every row action,
 * per-Account quota overrides, and the usage table with Lift today.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type {
  QuotaLimitOverride,
  QuotaUsageEntry,
  UserCreate,
  UserPublic,
  UserUpdate,
} from "@/client"
import { OverridesView, UsageView, UsersView } from "./operator-panels"

afterEach(cleanup)

const user = (over: Partial<UserPublic>): UserPublic =>
  ({
    id: "u1",
    email: "ann@x.test",
    full_name: "Ann",
    is_active: true,
    is_superuser: false,
    is_approved: true,
    created_at: null,
    ...over,
  }) as UserPublic

const usersProps = {
  users: [user({}), user({ id: "me", email: "me@x.test", full_name: null })],
  meId: "me",
  isPending: false,
  isError: false,
  onAdd: async () => {},
  onUpdate: async () => {},
  onDelete: async () => {},
  onViewAs: () => {},
  onExport: () => {},
}

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe("UsersView", () => {
  test("a refused list says so", () => {
    render(<UsersView {...usersProps} users={[]} isError />)
    expect(screen.getByText("Your account cannot manage users.")).toBeTruthy()
  })

  test("each row reads role and status; your own row has no actions", () => {
    render(
      <UsersView
        {...usersProps}
        users={[
          ...usersProps.users,
          user({ id: "u2", email: "bo@x.test", is_approved: false }),
          user({ id: "u3", email: "cy@x.test", is_superuser: true }),
        ]}
      />,
    )
    const row = (email: string) =>
      screen.getByRole("row", { name: new RegExp(email) })
    expect(row("ann@x.test").textContent).toContain("Active")
    expect(row("bo@x.test").textContent).toContain("Waiting for approval")
    expect(row("cy@x.test").textContent).toContain("Admin")
    expect(row("me@x.test").textContent).toContain("you")
    expect(screen.queryByRole("button", { name: "Edit me@x.test" })).toBeNull()
    expect(screen.getByRole("button", { name: "Edit ann@x.test" })).toBeTruthy()
  })

  test("Add user refuses a bad email and different passwords", () => {
    const onAdd = mock(async (_u: UserCreate) => {})
    render(<UsersView {...usersProps} onAdd={onAdd} />)
    fireEvent.click(screen.getByRole("button", { name: "Add user" }))
    fill("Email", "nope")
    fill("Password", "long-enough-1")
    fill("Password again", "long-enough-2")
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))
    expect(screen.getByText("Invalid email address")).toBeTruthy()
    fill("Email", "new@x.test")
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))
    expect(screen.getByText("The passwords don't match")).toBeTruthy()
    fill("Password", "short")
    fill("Password again", "short")
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))
    expect(
      screen.getByText("Password must be at least 8 characters"),
    ).toBeTruthy()
    expect(onAdd).not.toHaveBeenCalled()
  })

  test("Add user creates an approved, active account", async () => {
    const onAdd = mock(async (_u: UserCreate) => {})
    render(<UsersView {...usersProps} onAdd={onAdd} />)
    fireEvent.click(screen.getByRole("button", { name: "Add user" }))
    fill("Email", "new@x.test")
    fill("Full name", "New One")
    fill("Password", "long-enough")
    fill("Password again", "long-enough")
    fireEvent.click(screen.getByRole("button", { name: "Admin" }))
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({
        email: "new@x.test",
        full_name: "New One",
        password: "long-enough",
        is_superuser: true,
        is_active: true,
        is_approved: true,
      }),
    )
  })

  test("Edit sends the changed fields, and a password only when set", async () => {
    const onUpdate = mock(async (_id: string, _u: UserUpdate) => {})
    render(<UsersView {...usersProps} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole("button", { name: "Edit ann@x.test" }))
    fill("Full name", "Ann B")
    fireEvent.click(screen.getByRole("button", { name: "Active" }))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(onUpdate.mock.calls[0]).toEqual([
      "u1",
      {
        email: "ann@x.test",
        full_name: "Ann B",
        is_superuser: false,
        is_active: false,
        is_approved: true,
      },
    ])
  })

  test("a waiting account is approved from its row", async () => {
    const onUpdate = mock(async (_id: string, _u: UserUpdate) => {})
    render(
      <UsersView
        {...usersProps}
        users={[user({ id: "u2", email: "bo@x.test", is_approved: false })]}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Approve bo@x.test" }))
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith("u2", { is_approved: true }),
    )
  })

  test("View as, export and delete act on the row's account", async () => {
    const onViewAs = mock((_u: UserPublic) => {})
    const onExport = mock((_u: UserPublic) => {})
    const onDelete = mock(async (_id: string) => {})
    render(
      <UsersView
        {...usersProps}
        onViewAs={onViewAs}
        onExport={onExport}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "View as ann@x.test" }))
    fireEvent.click(screen.getByRole("button", { name: "Export ann@x.test" }))
    expect(onViewAs.mock.calls[0][0].id).toBe("u1")
    expect(onExport.mock.calls[0][0].id).toBe("u1")
    fireEvent.click(screen.getByRole("button", { name: "Delete ann@x.test" }))
    expect(screen.getByRole("dialog").textContent).toContain("permanently")
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("u1"))
  })
})

const override = (over: Partial<QuotaLimitOverride>): QuotaLimitOverride =>
  ({
    userId: "u1",
    email: "ann@x.test",
    budget: "auto_sync",
    allowance: 10,
    ceiling: null,
    ...over,
  }) as QuotaLimitOverride

describe("OverridesView", () => {
  const props = {
    users: [user({})],
    overrides: [override({})],
    onSave: async () => {},
    onClear: async () => {},
  }

  test("each override reads its numbers; blank inherits", () => {
    render(<OverridesView {...props} />)
    const row = screen.getByRole("row", { name: /ann@x\.test/ })
    expect(row.textContent).toContain("Scheduled syncing")
    expect(row.textContent).toContain("10")
    expect(row.textContent).toContain("inherit")
  })

  test("Override saves one account's limits for one Budget", async () => {
    const onSave = mock(
      async (_u: string, _b: string, _a: string, _c: string) => {},
    )
    render(<OverridesView {...props} onSave={onSave} />)
    fireEvent.click(screen.getByRole("button", { name: "Override" }))
    fireEvent.change(screen.getByLabelText("Account"), {
      target: { value: "u1" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Bulk actions" }))
    fill("Allowance", "0")
    fill("Ceiling", "500")
    fireEvent.click(screen.getByRole("button", { name: "Save override" }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("u1", "manual_bulk", "0", "500"),
    )
  })

  test("clearing an override asks first", async () => {
    const onClear = mock(async (_o: QuotaLimitOverride) => {})
    render(<OverridesView {...props} onClear={onClear} />)
    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear Scheduled syncing for ann@x.test",
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1))
  })
})

const entry = (over: Partial<QuotaUsageEntry>): QuotaUsageEntry =>
  ({
    userId: "u1",
    email: "ann@x.test",
    autoSync: 5,
    manualBulk: 2,
    manualSingle: 1,
    total: 8,
    autoSyncLifted: false,
    manualBulkLifted: false,
    manualSingleLifted: false,
    ...over,
  }) as QuotaUsageEntry

describe("UsageView", () => {
  const props = {
    day: "2026-10-20",
    today: "2026-10-20",
    onDay: () => {},
    users: [user({}), user({ id: "u2", email: "zero@x.test" })],
    entries: [entry({})],
    isPending: false,
    onLift: () => {},
    onOpenRequests: () => {},
  }

  test("links to the Requests tab, where the Requests went (RQS-03)", () => {
    const onOpenRequests = mock(() => {})
    render(<UsageView {...props} onOpenRequests={onOpenRequests} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Open the Requests tab" }),
    )
    expect(onOpenRequests).toHaveBeenCalledTimes(1)
  })

  test("every account is listed today, spent or not, so a blocked one can be lifted", () => {
    const onLift = mock((_id: string) => {})
    render(<UsageView {...props} onLift={onLift} />)
    expect(
      screen.getByRole("row", { name: /ann@x\.test/ }).textContent,
    ).toContain("8")
    fireEvent.click(
      screen.getByRole("button", { name: "Lift today for zero@x.test" }),
    )
    expect(onLift).toHaveBeenCalledWith("u2")
  })

  test("a lifted account says so instead", () => {
    render(<UsageView {...props} entries={[entry({ autoSyncLifted: true })]} />)
    expect(
      screen.getByRole("row", { name: /ann@x\.test/ }).textContent,
    ).toContain("Lifted today")
  })

  test("another day lists only who spent, with nothing to lift", () => {
    render(<UsageView {...props} day="2026-10-19" />)
    expect(screen.queryByRole("row", { name: /zero@x\.test/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Lift today/ })).toBeNull()
  })
})
