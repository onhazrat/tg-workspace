import { useQuery } from "@tanstack/react-query"
import type React from "react"

import { type UserPublic, usersReadUsers } from "@/client"
import AddUser from "@/components/Admin/AddUser"
import { columns } from "@/components/Admin/columns"
import QuotaLimits from "@/components/Admin/QuotaLimits"
import QuotaUsage from "@/components/Admin/QuotaUsage"
import { DataTable } from "@/components/Common/DataTable"
import PendingUsers from "@/components/Pending/PendingUsers"
import useAuth from "@/hooks/useAuth"

/**
 * The list body. The template's /admin page sent anyone without the
 * permission away before rendering; here the server's refusal is the answer,
 * so it is said rather than thrown into the workspace's error boundary.
 */
export const UsersTableBody: React.FC<{
  isPending: boolean
  isError: boolean
  users: UserPublic[]
  currentUserId: string
}> = ({ isPending, isError, users, currentUserId }) => {
  if (isPending) return <PendingUsers />
  if (isError)
    return (
      <p className="text-sm text-muted-foreground">
        Your account cannot manage users.
      </p>
    )
  // Scoped for the e2e specs: the section renders three tables, and
  // `getByRole("row")` spans all of them. QuotaUsage lists the same
  // addresses, so an unscoped row lookup matches two elements per user.
  return (
    <div data-testid="users-table">
      <DataTable
        columns={columns}
        data={users.map((u) => ({
          ...u,
          isCurrentUser: u.id === currentUserId,
        }))}
      />
    </div>
  )
}

/** The template's /admin page (SET-01), unchanged until SET-03 redraws it. */
export const UsersSection: React.FC = () => {
  const { user } = useAuth()
  const { data, isPending, isError } = useQuery({
    queryFn: () => usersReadUsers({ query: { skip: 0, limit: 100 } }),
    queryKey: ["users"],
    retry: false,
  })
  return (
    <div className="flex flex-col gap-6" data-testid="settings-users">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-widest">Users</h3>
          <p className="text-muted-foreground text-sm">
            Manage user accounts and permissions
          </p>
        </div>
        {data ? <AddUser /> : null}
      </div>
      <UsersTableBody
        isPending={isPending}
        isError={isError}
        users={data?.data ?? []}
        currentUserId={user?.id ?? ""}
      />
      {data ? (
        <>
          <QuotaLimits />
          <QuotaUsage />
        </>
      ) : null}
    </div>
  )
}
