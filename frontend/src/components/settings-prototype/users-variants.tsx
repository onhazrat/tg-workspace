/**
 * PROTOTYPE (settings redesign, Users page styling), throwaway. Three takes on
 * Admin → Users drawn with the settings rows' own parts instead of the
 * template's shadcn table:
 *
 * - F `rows`: one settings-style row per account, the action in the page header.
 * - G `filters`: F plus the settings search and filter chips, with pending
 *   accounts surfaced and approvable inline.
 * - H `detail`: a list on the left, the selected account's fields as settings
 *   rows on the right, auto-saving like every other setting.
 *
 * Roles come from the prototype API (`GET /proto/users/roles`), because
 * `UserPublic` carries only `is_superuser`, which access no longer reads.
 * Every write goes through the real users API, as the production dialogs do.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react"
import type React from "react"
import { useState } from "react"
import { toast } from "sonner"
import { headers } from "@/api/base"
import {
  quotaReadQuotaUsage,
  type UserPublic,
  usersReadUsers,
  usersUpdateUser,
} from "@/client"
import AddUser from "@/components/Admin/AddUser"
import DeleteUser from "@/components/Admin/DeleteUser"
import EditUser from "@/components/Admin/EditUser"
import ExportUserData from "@/components/Admin/ExportUserData"
import ViewAsUser from "@/components/Admin/ViewAsUser"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TgToggle } from "@/components/ui/tg-toggle"
import useAuth from "@/hooks/useAuth"
import useViewAs from "@/hooks/useViewAs"
import { exportAccountBlob } from "@/lib/data-transfer/database"
import {
  buildTimestampedFilename,
  downloadBlob,
} from "@/lib/data-transfer/download"
import { cn } from "@/lib/utils"
import { TextField } from "./schema-settings"
import { Chip } from "./VariantD"

export type UsersStyle = "rows" | "filters" | "detail"

// --- Data ------------------------------------------------------------------------

function useUsersData() {
  const { user: me } = useAuth()
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => usersReadUsers({ query: { skip: 0, limit: 500 } }),
  })
  const roles = useQuery({
    queryKey: ["proto-user-roles"],
    queryFn: async () => {
      const r = await fetch("/proto/users/roles", { headers: headers() })
      return r.ok ? ((await r.json()) as Record<string, string[]>) : {}
    },
  })
  const usage = useQuery({
    queryKey: ["quota-usage-today"],
    queryFn: () => quotaReadQuotaUsage(),
  })
  const requests = Object.fromEntries(
    (usage.data?.entries ?? []).map((e) => [e.userId, e.total ?? 0]),
  )
  return {
    me,
    users: users.data?.data ?? [],
    loading: users.isLoading,
    rolesOf: (u: UserPublic) => roles.data?.[u.id] ?? [],
    requestsOf: (u: UserPublic) => requests[u.id] ?? 0,
  }
}

type UsersData = ReturnType<typeof useUsersData>

function usePatchUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      usersUpdateUser({ path: { user_id: id }, body }),
    onSuccess: () => toast.success("Saved"),
    onError: (e) => toast.error(String(e)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  })
}

const isPending = (u: UserPublic) => u.is_approved === false
const isAdminRole = (roles: string[]) =>
  roles.includes("owner") || roles.includes("admin")
const joined = (u: UserPublic) =>
  u.created_at
    ? `joined ${new Date(u.created_at).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}`
    : null

// --- Shared parts ----------------------------------------------------------------

/** Same outline-chip shape as the scope badge on every setting row. */
const RoleChip: React.FC<{ roles: string[] }> = ({ roles }) => {
  const top = roles.includes("owner")
    ? "owner"
    : roles.includes("admin")
      ? "admin"
      : "user"
  return (
    <span
      title={roles.length ? `Roles: ${roles.join(", ")}` : "No role row"}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-none whitespace-nowrap",
        top === "owner" &&
          "border-violet-500/30 text-violet-700 dark:text-violet-300",
        top === "admin" &&
          "border-amber-500/30 text-amber-700 dark:text-amber-300",
        top === "user" && "border-app-ink/15 text-app-ink/60",
      )}
    >
      {top.charAt(0).toUpperCase() + top.slice(1)}
    </span>
  )
}

const StatusChip: React.FC<{ user: UserPublic }> = ({ user }) =>
  isPending(user) ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] leading-none text-amber-700 dark:text-amber-300">
      Waiting for approval
    </span>
  ) : user.is_active ? null : (
    <span className="inline-flex items-center gap-1 rounded-full border border-app-ink/15 px-2 py-0.5 text-[11px] leading-none text-app-ink/50">
      Inactive
    </span>
  )

/** The `…` menu every setting row has, with the account actions. */
const UserMenu: React.FC<{ user: UserPublic; isMe: boolean }> = ({
  user,
  isMe,
}) => {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const patch = usePatchUser()
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${user.email}`}
          className="mt-0.5 rounded p-1 text-app-ink/40 hover:bg-app-ink/5 hover:text-app-ink"
        >
          <MoreHorizontal size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isPending(user) ? (
            <DropdownMenuItem
              onClick={() =>
                patch.mutate({ id: user.id, body: { is_approved: true } })
              }
            >
              <Check size={14} /> Approve
            </DropdownMenuItem>
          ) : null}
          {isMe ? null : (
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil size={14} /> Edit
            </DropdownMenuItem>
          )}
          {isMe ? null : <ViewAsUser user={user} />}
          <ExportUserData user={user} />
          <DropdownMenuItem
            onClick={async () => {
              await navigator.clipboard.writeText(user.id)
              toast.success("Copied account id")
            }}
          >
            Copy account id
          </DropdownMenuItem>
          {isMe ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 size={14} /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <EditUser user={user} open={editOpen} onOpenChange={setEditOpen} />
      <DeleteUser id={user.id} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  )
}

/** One account, laid out exactly like a setting row. */
const UserRow: React.FC<{
  user: UserPublic
  data: UsersData
  inlineApprove?: boolean
}> = ({ user, data, inlineApprove }) => {
  const patch = usePatchUser()
  const isMe = data.me?.id === user.id
  const meta = [
    user.email,
    joined(user),
    `${data.requestsOf(user).toLocaleString()} requests today`,
  ].filter(Boolean)
  return (
    <div
      className={cn(
        "flex items-start gap-4 border-b border-app-ink/10 py-4",
        !user.is_active && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">
            {user.full_name || user.email.split("@")[0]}
          </span>
          {isMe ? (
            <span className="rounded-full border border-app-ink/15 px-1.5 py-0.5 text-[11px] leading-none text-app-ink/60">
              You
            </span>
          ) : null}
          <RoleChip roles={data.rolesOf(user)} />
          <StatusChip user={user} />
        </div>
        <p className="mt-1 font-mono text-[11px] text-app-ink/40">
          {meta.join(" · ")}
        </p>
      </div>
      {inlineApprove && isPending(user) ? (
        <button
          type="button"
          onClick={() =>
            patch.mutate({ id: user.id, body: { is_approved: true } })
          }
          className="shrink-0 rounded border border-app-ink/20 px-3 py-1 text-xs hover:border-app-ink/50"
        >
          Approve
        </button>
      ) : null}
      <UserMenu user={user} isMe={isMe} />
    </div>
  )
}

/** The production Add dialog, its trigger reshaped into a header action. */
export const AddUserAction: React.FC = () => (
  <div className="[&>button]:my-0 [&>button]:h-8 [&>button]:rounded [&>button]:border [&>button]:border-app-ink/20 [&>button]:bg-transparent [&>button]:px-3 [&>button]:text-xs [&>button]:font-normal [&>button]:text-app-ink [&>button]:shadow-none [&>button:hover]:border-app-ink/50 [&_svg]:mr-0">
    <AddUser />
  </div>
)

// --- F: rows ---------------------------------------------------------------------

const UsersRows: React.FC = () => {
  const data = useUsersData()
  if (data.loading) return <p className="text-sm text-app-ink/50">Loading…</p>
  return (
    <div className="max-w-4xl border-t border-app-ink/10">
      {data.users.map((u) => (
        <UserRow key={u.id} user={u} data={data} />
      ))}
    </div>
  )
}

// --- G: rows with search and filters ---------------------------------------------

type Filter = "all" | "admins" | "pending" | "inactive"

const UsersFiltered: React.FC = () => {
  const data = useUsersData()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const pending = data.users.filter(isPending)
  const keep: Record<Filter, (u: UserPublic) => boolean> = {
    all: () => true,
    admins: (u) => isAdminRole(data.rolesOf(u)),
    pending: isPending,
    inactive: (u) => !u.is_active,
  }
  const q = query.trim().toLowerCase()
  const shown = data.users
    .filter(keep[filter])
    .filter(
      (u) =>
        !q ||
        `${u.full_name ?? ""} ${u.email} ${data.rolesOf(u).join(" ")}`
          .toLowerCase()
          .includes(q),
    )
    .sort((a, b) => Number(isPending(b)) - Number(isPending(a)))
  const count = (f: Filter) => data.users.filter(keep[f]).length
  return (
    <div className="max-w-4xl">
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-ink/40"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search accounts by name, email or role"
          aria-label="Search accounts"
          className="w-full rounded border border-app-ink/15 bg-transparent py-2 pl-9 pr-9 text-sm outline-none focus:border-app-ink/40"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-app-ink/50"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      <div className="mt-2 mb-4 flex flex-wrap gap-1.5">
        <Chip on={filter === "all"} onClick={() => setFilter("all")}>
          Everyone ({data.users.length})
        </Chip>
        <Chip on={filter === "admins"} onClick={() => setFilter("admins")}>
          Admins ({count("admins")})
        </Chip>
        <Chip on={filter === "pending"} onClick={() => setFilter("pending")}>
          Waiting for approval ({pending.length})
        </Chip>
        <Chip on={filter === "inactive"} onClick={() => setFilter("inactive")}>
          Inactive ({count("inactive")})
        </Chip>
      </div>
      {pending.length && filter === "all" && !q ? (
        <p className="mb-2 text-[13px] text-amber-700 dark:text-amber-300">
          {pending.length} account{pending.length === 1 ? " is" : "s are"}{" "}
          waiting for approval and can't read any data yet.
        </p>
      ) : null}
      <div className="border-t border-app-ink/10">
        {shown.map((u) => (
          <UserRow key={u.id} user={u} data={data} inlineApprove />
        ))}
        {shown.length === 0 && !data.loading ? (
          <p className="py-8 text-center text-sm text-app-ink/50">
            No accounts match.
          </p>
        ) : null}
      </div>
    </div>
  )
}

// --- H: list and detail ----------------------------------------------------------

/** A setting row, minus the schema: title, help line, control. */
const FieldRow: React.FC<{
  title: string
  help: string
  id: string
  children: React.ReactNode
}> = ({ title, help, id, children }) => (
  <div className="flex items-start gap-4 border-b border-app-ink/10 py-4">
    <div className="min-w-0 flex-1">
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1 text-[13px] leading-snug text-app-ink/60">{help}</p>
      <p className="mt-1 font-mono text-[11px] text-app-ink/35">{id}</p>
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)

const UsersDetail: React.FC = () => {
  const data = useUsersData()
  const patch = usePatchUser()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { start: viewAs } = useViewAs()
  const user = data.users.find((u) => u.id === selectedId) ?? data.users[0]
  if (!user) return <p className="text-sm text-app-ink/50">Loading…</p>
  const isMe = data.me?.id === user.id
  const set = (body: Record<string, unknown>) =>
    patch.mutate({ id: user.id, body })
  return (
    <div className="-mx-8 -my-8 flex min-h-[32rem]">
      <div className="w-64 shrink-0 border-r border-app-ink/10 py-4">
        {data.users.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => setSelectedId(u.id)}
            className={cn(
              "block w-full px-4 py-2 text-left",
              u.id === user.id ? "bg-app-ink/10" : "hover:bg-app-ink/5",
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <span className="truncate">
                {u.full_name || u.email.split("@")[0]}
              </span>
              {isPending(u) ? (
                <span
                  title="Waiting for approval"
                  className="size-1.5 shrink-0 rounded-full bg-amber-500"
                />
              ) : null}
            </span>
            <span className="block truncate font-mono text-[11px] text-app-ink/40">
              {u.email}
            </span>
          </button>
        ))}
      </div>
      <div className="min-w-0 max-w-3xl flex-1 px-8 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-base font-semibold">
            {user.full_name || user.email}
          </h4>
          <RoleChip roles={data.rolesOf(user)} />
          <StatusChip user={user} />
        </div>
        <p className="mt-1 mb-4 font-mono text-[11px] text-app-ink/40">
          {[
            joined(user),
            `${data.requestsOf(user).toLocaleString()} requests today`,
            user.id,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="border-t border-app-ink/10">
          <FieldRow
            title="Name"
            help="Shown in the account menu and in this list."
            id="account.fullName"
          >
            <TextField
              value={user.full_name ?? ""}
              label="Name"
              onCommit={(v) => set({ full_name: v })}
            />
          </FieldRow>
          <FieldRow
            title="Email"
            help="Used to sign in and for password resets."
            id="account.email"
          >
            <TextField
              value={user.email}
              label="Email"
              onCommit={(v) => set({ email: v })}
            />
          </FieldRow>
          <FieldRow
            title="Approved"
            help="Until approved, the account can sign in but reads no data."
            id="account.approved"
          >
            <TgToggle
              checked={user.is_approved !== false}
              onClick={() => set({ is_approved: isPending(user) })}
              aria-label="Approved"
            />
          </FieldRow>
          <FieldRow
            title="Active"
            help="An inactive account cannot sign in. Its data stays."
            id="account.active"
          >
            <span className={cn(isMe && "pointer-events-none opacity-50")}>
              <TgToggle
                checked={Boolean(user.is_active)}
                onClick={() => set({ is_active: !user.is_active })}
                aria-label="Active"
              />
            </span>
          </FieldRow>
          <FieldRow
            title="Role"
            help="What this account may do. Changing roles has no API yet."
            id="account.roles"
          >
            <RoleChip roles={data.rolesOf(user)} />
          </FieldRow>
        </div>
        <h5 className="mt-8 mb-1 text-sm font-semibold">Actions</h5>
        <div className="border-t border-app-ink/10">
          {isMe ? null : (
            <FieldRow
              title="View as"
              help="Browse the app as this account, read-only, with an audit row."
              id="account.viewAs"
            >
              <ActionButton
                onClick={() =>
                  viewAs(user.id).catch((e) => toast.error(String(e)))
                }
              >
                <Eye size={13} /> View as
              </ActionButton>
            </FieldRow>
          )}
          <FieldRow
            title="Export data"
            help="Everything about this account, as one file."
            id="account.export"
          >
            <ActionButton
              onClick={() => {
                toast.info(`Exporting ${user.email}…`, { id: "export-user" })
                exportAccountBlob(user.id)
                  .then((blob) => {
                    downloadBlob(
                      blob,
                      buildTimestampedFilename(`export-${user.email}`),
                    )
                    toast.success("Export ready", { id: "export-user" })
                  })
                  .catch((e) =>
                    toast.error(`Export failed: ${e}`, { id: "export-user" }),
                  )
              }}
            >
              <Download size={13} /> Export
            </ActionButton>
          </FieldRow>
          {isMe ? null : (
            <FieldRow
              title="Delete account"
              help="Removes the account and everything it owns. Shared posts stay."
              id="account.delete"
            >
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="rounded border border-red-500/40 px-3 py-1 text-xs text-red-600 hover:bg-red-500/10"
              >
                Delete
              </button>
            </FieldRow>
          )}
        </div>
      </div>
      <DeleteUser id={user.id} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  )
}

const ActionButton: React.FC<{
  onClick: () => void
  children: React.ReactNode
}> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 rounded border border-app-ink/20 px-3 py-1 text-xs hover:border-app-ink/50"
  >
    {children}
  </button>
)

export const USERS_BODY: Record<UsersStyle, React.FC> = {
  rows: UsersRows,
  filters: UsersFiltered,
  detail: UsersDetail,
}
