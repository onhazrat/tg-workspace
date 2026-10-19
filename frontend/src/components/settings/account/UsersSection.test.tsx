/**
 * The users list the template's /admin page drew, now inside Settings
 * (SET-01). What is pinned: an account the server refuses is told so instead
 * of the section crashing, and the list marks the account looking at it.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"

import type { UserPublic } from "@/client"
import { UsersTableBody } from "./UsersSection"

afterEach(cleanup)

const user = (id: string, email: string): UserPublic =>
  ({
    id,
    email,
    full_name: null,
    is_active: true,
    is_superuser: false,
    is_approved: true,
  }) as UserPublic

describe("UsersTableBody", () => {
  test("a refused list says so rather than drawing an empty table", () => {
    render(
      <UsersTableBody isPending={false} isError users={[]} currentUserId="" />,
    )
    expect(screen.getByText("Your account cannot manage users.")).toBeTruthy()
    expect(screen.queryByTestId("users-table")).toBeNull()
  })

  test("lists every account and marks the one looking at it", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <UsersTableBody
          isPending={false}
          isError={false}
          users={[user("a", "a@x.test"), user("b", "b@x.test")]}
          currentUserId="b"
        />
      </QueryClientProvider>,
    )
    const table = screen.getByTestId("users-table")
    expect(table.textContent).toContain("a@x.test")
    expect(table.textContent).toContain("b@x.test")
    expect(screen.getAllByText("You")).toHaveLength(1)
  })
})
