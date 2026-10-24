/**
 * The Operator topic (SET-03): users with every row action the template's
 * admin page had (edit, approve, delete, View as, export), per-Account quota
 * overrides, and each Account's usage for a day with Lift today. The quota
 * defaults themselves are six deployment Setting rows since SET-02.
 *
 * View as and export are offered on every other row and refused by the
 * server where they do not apply, as before: whether a peer holds a
 * Permission is a fact the browser is not given, and publishing it so a
 * button could grey out would map the deployment's Admins to every client.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  type QuotaLimitOverride,
  type QuotaUsageEntry,
  quotaLiftQuotaCeiling,
  quotaReadQuotaLimits,
  quotaReadQuotaUsage,
  quotaSetQuotaLimitsForUser,
  type UserCreate,
  type UserPublic,
  type UserUpdate,
  usersCreateUser,
  usersDeleteUser,
  usersReadUsers,
  usersUpdateUser,
} from "@/client"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { RelativeTime } from "@/components/RelativeTime"
import { TgButton } from "@/components/ui/tg-button"
import { TgInlineChoice } from "@/components/ui/tg-inline-segments"
import { useUI } from "@/contexts/UIContext"
import { queryKeys } from "@/hooks/queryKeys"
import useAuth from "@/hooks/useAuth"
import { budgetLabel } from "@/hooks/useMyQuota"
import useViewAs from "@/hooks/useViewAs"
import { exportAccountBlob } from "@/lib/data-transfer/database"
import {
  buildTimestampedFilename,
  downloadBlob,
} from "@/lib/data-transfer/download"
import {
  BUDGETS,
  budgetsFrom,
  overrideDraftFor,
  showLimit,
  withLimit,
} from "@/lib/quota/limits-model"
import {
  ConfirmButton,
  cellClass,
  errorOf,
  FormError,
  FormInput,
  FormPill,
  fieldClass,
  ListTable,
  Note,
  RowAction,
  rowClass,
  Status,
} from "./kit"

const EMAIL = /^\S+@\S+\.\S+$/

/** Why a user form cannot be sent, or `null`. A blank password is no change. */
function userRefusal(
  email: string,
  password: string,
  again: string,
  passwordRequired: boolean,
): string | null {
  if (!EMAIL.test(email)) return "Invalid email address"
  if (!password && !passwordRequired) return null
  if (password.length < 8) return "Password must be at least 8 characters"
  if (password !== again) return "The passwords don't match"
  return null
}

interface UserDraft {
  email: string
  full_name: string
  password: string
  again: string
  is_superuser: boolean
  is_active: boolean
  is_approved: boolean
}

const draftOf = (u?: UserPublic): UserDraft => ({
  email: u?.email ?? "",
  full_name: u?.full_name ?? "",
  password: "",
  again: "",
  is_superuser: Boolean(u?.is_superuser),
  is_active: u?.is_active ?? true,
  is_approved: u?.is_approved ?? true,
})

/** The add and edit form: one shape, so the two cannot drift apart. */
function UserForm({
  user,
  pill,
  ariaLabel,
  heading,
  submit,
  onSubmit,
}: {
  user?: UserPublic
  pill: string
  ariaLabel?: string
  heading: string
  submit: string
  onSubmit: (draft: UserDraft) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [d, setD] = useState(() => draftOf(user))
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const openChange = (next: boolean) => {
    if (next) {
      setD(draftOf(user))
      setError("")
    }
    setOpen(next)
  }
  const send = async () => {
    const refusal = userRefusal(d.email, d.password, d.again, !user)
    setError(refusal ?? "")
    if (refusal) return
    setBusy(true)
    try {
      await onSubmit(d)
      setOpen(false)
    } catch (e) {
      setError(errorOf(e))
    } finally {
      setBusy(false)
    }
  }
  const set = (patch: Partial<UserDraft>) => setD({ ...d, ...patch })
  const toggle = (
    key: "is_superuser" | "is_active" | "is_approved",
    label: string,
    title: string,
  ) => (
    <BarToggle
      on={d[key]}
      label={label}
      title={title}
      onClick={() => set({ [key]: !d[key] })}
    />
  )
  return (
    <FormPill
      label={pill}
      ariaLabel={ariaLabel}
      heading={heading}
      icon={user ? <Pencil size={11} /> : undefined}
      open={open}
      onOpenChange={openChange}
    >
      <FormInput
        type="email"
        label="Email"
        value={d.email}
        onChange={(email) => set({ email })}
      />
      <FormInput
        label="Full name"
        value={d.full_name}
        onChange={(full_name) => set({ full_name })}
      />
      <FormInput
        type="password"
        label="Password"
        placeholder={user ? "New password, blank keeps it" : "Password"}
        value={d.password}
        onChange={(password) => set({ password })}
      />
      <FormInput
        type="password"
        label="Password again"
        value={d.again}
        onChange={(again) => set({ again })}
        onEnter={() => void send()}
      />
      <div className="flex flex-wrap gap-1.5">
        {toggle("is_superuser", "Admin", "Holds every Permission")}
        {user && toggle("is_active", "Active", "Can sign in")}
        {user && toggle("is_approved", "Approved", "Past the approval gate")}
      </div>
      <FormError>{error}</FormError>
      <TgButton size="sm" loading={busy} onClick={() => void send()}>
        {submit}
      </TgButton>
    </FormPill>
  )
}

function UserStatus({ user }: { user: UserPublic }) {
  if (!user.is_active) return <Status tone="off">Switched off</Status>
  if (user.is_approved === false)
    return <Status tone="warn">Waiting for approval</Status>
  return <Status tone="ok">Active</Status>
}

function UserActions({
  user,
  onUpdate,
  onDelete,
  onViewAs,
  onExport,
}: {
  user: UserPublic
  onUpdate: (id: string, body: UserUpdate) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
  onViewAs: (user: UserPublic) => void
  onExport: (user: UserPublic) => void
}) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {user.is_approved === false && (
        <RowAction
          label={`Approve ${user.email}`}
          onClick={() => void onUpdate(user.id, { is_approved: true })}
        >
          Approve
        </RowAction>
      )}
      <UserForm
        user={user}
        pill="Edit"
        ariaLabel={`Edit ${user.email}`}
        heading={`Edit ${user.email}`}
        submit="Save"
        onSubmit={({ password, again: _, ...fields }) =>
          onUpdate(user.id, password ? { ...fields, password } : fields)
        }
      />
      <RowAction label={`View as ${user.email}`} onClick={() => onViewAs(user)}>
        View as
      </RowAction>
      <RowAction label={`Export ${user.email}`} onClick={() => onExport(user)}>
        Export
      </RowAction>
      <ConfirmButton
        label={`Delete ${user.email}`}
        title={`Delete ${user.email}?`}
        description="Everything this account owns is permanently deleted with it: its follows, Summaries, Chats, Tag runs, keys, bots and Settings. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => onDelete(user.id)}
      />
    </span>
  )
}

export function UsersView({
  users,
  meId,
  isPending,
  isError,
  onAdd,
  onUpdate,
  onDelete,
  onViewAs,
  onExport,
}: {
  users: UserPublic[]
  meId: string
  isPending: boolean
  isError: boolean
  onAdd: (user: UserCreate) => Promise<unknown>
  onUpdate: (id: string, body: UserUpdate) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
  onViewAs: (user: UserPublic) => void
  onExport: (user: UserPublic) => void
}) {
  if (isError)
    return (
      <p className="text-xs text-app-ink/60">
        Your account cannot manage users.
      </p>
    )
  return (
    <div className="space-y-2">
      <UserForm
        pill="Add user"
        heading="An approved account, signed in with this password"
        submit="Create user"
        onSubmit={({ again: _, full_name, ...fields }) =>
          onAdd({
            ...fields,
            full_name: full_name || null,
            is_active: true,
            is_approved: true,
          })
        }
      />
      <ListTable
        testId="users-table"
        columns={[
          { label: "Account" },
          { label: "Role" },
          { label: "Status" },
          { label: "Joined" },
          { label: "" },
        ]}
        isEmpty={!users.length}
        empty={isPending ? "Loading…" : "No users"}
      >
        {users.map((u) => (
          <tr key={u.id} className={rowClass}>
            <td className={cellClass}>
              <div className="font-semibold">
                {u.email}
                {u.id === meId && (
                  <span className="ml-2 rounded-full bg-app-ink/10 px-1.5 text-[10px] font-normal">
                    you
                  </span>
                )}
              </div>
              {u.full_name && (
                <div className="text-[11px] text-app-ink/50">{u.full_name}</div>
              )}
            </td>
            <td className={cellClass}>{u.is_superuser ? "Admin" : "Member"}</td>
            <td className={cellClass}>
              <UserStatus user={u} />
            </td>
            <td className={`${cellClass} text-app-ink/60`}>
              {u.created_at ? (
                <RelativeTime timestamp={new Date(u.created_at).getTime()} />
              ) : (
                "—"
              )}
            </td>
            <td className={`${cellClass} text-right`}>
              {u.id !== meId && (
                <UserActions
                  user={u}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  onViewAs={onViewAs}
                  onExport={onExport}
                />
              )}
            </td>
          </tr>
        ))}
      </ListTable>
    </div>
  )
}

const USERS_KEY = ["users"]
const readUsers = () => usersReadUsers({ query: { skip: 0, limit: 100 } })

export function Users() {
  const { user: me } = useAuth()
  const client = useQueryClient()
  const { start } = useViewAs()
  const { data, isPending, isError } = useQuery({
    queryKey: USERS_KEY,
    queryFn: readUsers,
    retry: false,
  })
  const refresh = () => client.invalidateQueries({ queryKey: USERS_KEY })
  return (
    <UsersView
      users={data?.data ?? []}
      meId={me?.id ?? ""}
      isPending={isPending}
      isError={isError}
      onAdd={async (body) => {
        await usersCreateUser({ body })
        toast.success("User created successfully")
        await refresh()
      }}
      onUpdate={async (id, body) => {
        await usersUpdateUser({ path: { user_id: id }, body })
        toast.success("User updated successfully")
        await refresh()
      }}
      onDelete={async (id) => {
        await usersDeleteUser({ path: { user_id: id } })
        toast.success("The user was deleted successfully")
        // Everything the account owned went with it, so every list may change.
        await client.invalidateQueries()
      }}
      onViewAs={(u) => start(u.id).catch((e) => toast.error(errorOf(e)))}
      onExport={(u) => {
        toast.info(`Exporting ${u.email}…`, { id: "export-user" })
        exportAccountBlob(u.id)
          .then((blob) => {
            downloadBlob(blob, buildTimestampedFilename(`export-${u.email}`))
            toast.success("Export ready", { id: "export-user" })
          })
          .catch((e) =>
            toast.error(`Export failed: ${errorOf(e)}`, { id: "export-user" }),
          )
      }}
    />
  )
}

const limitRefusal = (v: string) =>
  v.trim() === "" || Number.isFinite(Number(v)) ? null : "A number, or blank"

export function OverridesView({
  users,
  overrides,
  onSave,
  onClear,
}: {
  users: UserPublic[]
  overrides: QuotaLimitOverride[]
  /** Blank allowance or ceiling inherits the deployment's. */
  onSave: (
    userId: string,
    budget: string,
    allowance: string,
    ceiling: string,
  ) => Promise<unknown>
  onClear: (row: QuotaLimitOverride) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState("")
  const [budget, setBudget] = useState<string>(BUDGETS[0])
  const [allowance, setAllowance] = useState("")
  const [ceiling, setCeiling] = useState("")
  const [error, setError] = useState("")
  const save = async () => {
    const refusal = limitRefusal(allowance) ?? limitRefusal(ceiling)
    setError(refusal ?? "")
    if (refusal) return
    try {
      await onSave(userId, budget, allowance, ceiling)
      setOpen(false)
    } catch (e) {
      setError(errorOf(e))
    }
  }
  return (
    <div className="space-y-2">
      <FormPill
        label="Override"
        heading="Limits for one account, over the deployment's"
        open={open}
        onOpenChange={setOpen}
      >
        <select
          aria-label="Account"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className={`${fieldClass} w-full`}
        >
          <option value="">Pick an account</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email}
            </option>
          ))}
        </select>
        <TgInlineChoice
          aria-label="Budget"
          value={budget}
          onChange={setBudget}
          options={BUDGETS.map((b) => ({ value: b, label: budgetLabel(b) }))}
        />
        <div className="flex gap-2">
          <FormInput
            label="Allowance"
            placeholder="Allowance, blank inherits"
            value={allowance}
            onChange={setAllowance}
          />
          <FormInput
            label="Ceiling"
            placeholder="Ceiling, blank inherits"
            value={ceiling}
            onChange={setCeiling}
          />
        </div>
        <Note>0 always runs best-effort; a negative number is unlimited.</Note>
        <FormError>{error}</FormError>
        <TgButton size="sm" disabled={!userId} onClick={() => void save()}>
          Save override
        </TgButton>
      </FormPill>
      <ListTable
        testId="quota-overrides"
        columns={[
          { label: "Account" },
          { label: "Budget" },
          { label: "Allowance", className: "text-right" },
          { label: "Ceiling", className: "text-right" },
          { label: "" },
        ]}
        isEmpty={!overrides.length}
        empty="No account has its own limits."
      >
        {overrides.map((o) => (
          <tr key={`${o.userId}-${o.budget}`} className={rowClass}>
            <td className={`${cellClass} font-semibold`}>
              {o.email ?? o.userId}
            </td>
            <td className={cellClass}>{budgetLabel(o.budget)}</td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {showLimit(o.allowance) || "inherit"}
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {showLimit(o.ceiling) || "inherit"}
            </td>
            <td className={`${cellClass} text-right`}>
              <ConfirmButton
                label={`Clear ${budgetLabel(o.budget)} for ${o.email ?? o.userId}`}
                title="Clear this override?"
                description={`${o.email ?? o.userId} goes back to the deployment's ${budgetLabel(o.budget)} limits.`}
                confirmLabel="Clear"
                onConfirm={() => onClear(o)}
              />
            </td>
          </tr>
        ))}
      </ListTable>
    </div>
  )
}

function useQuotaInvalidate() {
  const client = useQueryClient()
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.quotaLimits() }),
      client.invalidateQueries({ queryKey: queryKeys.myQuota() }),
      client.invalidateQueries({ queryKey: ["quotaUsage"] }),
    ])
}

export function Overrides() {
  const invalidate = useQuotaInvalidate()
  const { data } = useQuery({
    queryKey: queryKeys.quotaLimits(),
    queryFn: () => quotaReadQuotaLimits(),
  })
  const { data: users } = useQuery({
    queryKey: USERS_KEY,
    queryFn: readUsers,
    retry: false,
  })
  return (
    <OverridesView
      users={users?.data ?? []}
      overrides={data?.overrides ?? []}
      onSave={async (userId, budget, allowance, ceiling) => {
        // Seeded from this account's own rows, so saving one Budget keeps
        // the other two as they were.
        const draft = withLimit(
          withLimit(
            overrideDraftFor(data?.overrides, userId),
            budget,
            "allowance",
            allowance,
          ),
          budget,
          "ceiling",
          ceiling,
        )
        await quotaSetQuotaLimitsForUser({
          path: { user_id: userId },
          body: { budgets: budgetsFrom(draft) },
        })
        await invalidate()
      }}
      onClear={async (o) => {
        await quotaSetQuotaLimitsForUser({
          path: { user_id: o.userId },
          body: {
            budgets: [{ budget: o.budget, allowance: null, ceiling: null }],
          },
        })
        await invalidate()
      }}
    />
  )
}

const lifted = (e: QuotaUsageEntry | undefined) =>
  Boolean(e?.autoSyncLifted || e?.manualBulkLifted || e?.manualSingleLifted)

/**
 * Today lists every account, not only those with a ledger row: an account
 * blocked by a ceiling of zero has spent nothing and has no row, and that is
 * exactly the one Lift today exists for. Another day lists who spent.
 */
function usageRows(
  users: UserPublic[],
  entries: QuotaUsageEntry[],
  isToday: boolean,
) {
  const spent = new Set(entries.map((e) => e.userId))
  const rows: { userId: string; email: string; e?: QuotaUsageEntry }[] =
    entries.map((e) => ({ userId: e.userId, email: e.email, e }))
  if (isToday)
    for (const u of users)
      if (!spent.has(u.id)) rows.push({ userId: u.id, email: u.email })
  return rows.sort((a, b) => (b.e?.total ?? 0) - (a.e?.total ?? 0))
}

export function UsageView({
  day,
  today,
  onDay,
  users,
  entries,
  isPending,
  onLift,
  onOpenRequests,
}: {
  day: string
  today: string
  onDay: (day: string) => void
  users: UserPublic[]
  entries: QuotaUsageEntry[]
  isPending: boolean
  onLift: (userId: string) => void
  onOpenRequests: () => void
}) {
  const isToday = day === today
  const rows = usageRows(users, entries, isToday)
  const num = (n?: number) => (n ?? 0).toLocaleString("en-US")
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[11px] text-app-ink/60">
        Day (UTC)
        <input
          type="date"
          aria-label="Usage day"
          value={day}
          max={today}
          onChange={(e) => onDay(e.target.value || today)}
          className={`${fieldClass} w-36`}
        />
      </label>
      <ListTable
        testId="quota-usage"
        columns={[
          { label: "Account" },
          { label: "Scheduled", className: "text-right" },
          { label: "Bulk", className: "text-right" },
          { label: "Single", className: "text-right" },
          { label: "Total", className: "text-right" },
          { label: "" },
        ]}
        isEmpty={!rows.length}
        empty={isPending ? "Loading…" : `No Requests were made on ${day}.`}
      >
        {rows.map(({ userId, email, e }) => (
          <tr key={userId} className={rowClass}>
            <td className={`${cellClass} font-semibold`}>{email}</td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {num(e?.autoSync)}
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {num(e?.manualBulk)}
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {num(e?.manualSingle)}
            </td>
            <td
              className={`${cellClass} text-right font-semibold tabular-nums`}
            >
              {num(e?.total)}
            </td>
            <td className={`${cellClass} text-right`}>
              {isToday &&
                (lifted(e) ? (
                  <Status tone="ok">Lifted today</Status>
                ) : (
                  <RowAction
                    label={`Lift today for ${email}`}
                    onClick={() => onLift(userId)}
                  >
                    Lift today
                  </RowAction>
                ))}
            </td>
          </tr>
        ))}
      </ListTable>
      <Note>
        A Request is one page fetched from Telegram. Lift today lifts all three
        ceilings until UTC midnight. Where they went, by kind of work and by
        Channel, is on the{" "}
        <button
          type="button"
          aria-label="Open the Requests tab"
          className="underline hover:text-app-ink"
          onClick={onOpenRequests}
        >
          Requests tab
        </button>
        .
      </Note>
    </div>
  )
}

/** Today in UTC, the ledger's day boundary rather than the browser's. */
const todayUtc = () => new Date().toISOString().slice(0, 10)

export function Usage() {
  const { workspaceTabs } = useUI()
  const invalidate = useQuotaInvalidate()
  const today = todayUtc()
  const [day, setDay] = useState(today)
  const { data, isPending } = useQuery({
    queryKey: queryKeys.quotaUsage(day),
    queryFn: () => quotaReadQuotaUsage({ query: day === today ? {} : { day } }),
  })
  const { data: users } = useQuery({
    queryKey: USERS_KEY,
    queryFn: readUsers,
    retry: false,
  })
  const lift = useMutation({
    mutationFn: (userId: string) =>
      quotaLiftQuotaCeiling({
        path: { user_id: userId },
        // No Budgets named: all three, which is what unblocking somebody in
        // a hurry means. It expires at the daily reset.
        body: { budgets: [], lifted: true },
      }),
    onSuccess: () => {
      toast.success("Lifted until UTC midnight")
      void invalidate()
    },
    onError: (e) => toast.error(errorOf(e)),
  })
  return (
    <UsageView
      day={day}
      today={today}
      onDay={setDay}
      users={users?.data ?? []}
      entries={data?.entries ?? []}
      isPending={isPending}
      onLift={(id) => lift.mutate(id)}
      onOpenRequests={() => workspaceTabs.openTab("requests")}
    />
  )
}
