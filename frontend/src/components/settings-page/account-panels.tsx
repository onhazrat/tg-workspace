/**
 * The Account topic's panels (SET-03): who is signed in, the profile, the
 * password, today's usage, and deleting the Account. Each is a props-only
 * view and a container that hands it the production calls, which are the
 * same generated-client calls the template's account page made.
 */
import { useQueryClient } from "@tanstack/react-query"
import { KeyRound, LogOut, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  type MyBudgetUsage,
  usersDeleteUserMe,
  usersUpdatePasswordMe,
  usersUpdateUserMe,
} from "@/client"
import { TgButton } from "@/components/ui/tg-button"
import useAuth from "@/hooks/useAuth"
import { budgetRow, useMyQuota } from "@/hooks/useMyQuota"
import {
  ConfirmButton,
  cellClass,
  errorOf,
  FormError,
  FormInput,
  FormPill,
  ListTable,
  PanelField,
  rowClass,
  Status,
} from "./kit"

export function SignedInAs({
  email,
  onSignOut,
}: {
  email: string
  onSignOut: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="text-app-ink/60">
        Signed in as <span className="font-semibold text-app-ink">{email}</span>
      </span>
      <TgButton size="sm" variant="secondary" onClick={onSignOut}>
        <LogOut size={12} /> Sign out
      </TgButton>
    </div>
  )
}

export function SignIn() {
  const { user, logout } = useAuth()
  return <SignedInAs email={user?.email ?? ""} onSignOut={logout} />
}

const EMAIL = /^\S+@\S+\.\S+$/

/** Name and email, each saved on Enter or blur like a row. */
export function Profile() {
  const { user } = useAuth()
  const client = useQueryClient()
  const save = async (field: "full_name" | "email", value: string) => {
    try {
      await usersUpdateUserMe({ body: { [field]: value } })
      await client.invalidateQueries({ queryKey: ["currentUser"] })
      toast.success("Saved")
    } catch (e) {
      toast.error(errorOf(e))
    }
  }
  return (
    <dl className="grid max-w-lg grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 text-xs">
      <dt className="pt-2 text-[11px] text-app-ink/60">Full name</dt>
      <dd>
        <PanelField
          label="Full name"
          value={user?.full_name ?? ""}
          placeholder="Not set"
          onCommit={(v) => void save("full_name", v)}
        />
      </dd>
      <dt className="pt-2 text-[11px] text-app-ink/60">Email</dt>
      <dd>
        <PanelField
          label="Email"
          type="email"
          value={user?.email ?? ""}
          invalid={(v) => (EMAIL.test(v) ? null : "Invalid email address")}
          onCommit={(v) => void save("email", v)}
        />
      </dd>
    </dl>
  )
}

/** Why a new password cannot be sent, or `null`. */
function passwordRefusal(next: string, again: string): string | null {
  if (next.length < 8) return "Password must be at least 8 characters"
  if (next !== again) return "The passwords don't match"
  return null
}

export function PasswordForm({
  onChange,
}: {
  onChange: (current: string, next: string) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [again, setAgain] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const refusal = passwordRefusal(next, again)
    setError(refusal ?? "")
    if (refusal) return
    setBusy(true)
    try {
      await onChange(current, next)
      setCurrent("")
      setNext("")
      setAgain("")
      setOpen(false)
    } catch (e) {
      setError(errorOf(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormPill
      label="Change password"
      heading="Change password"
      icon={<KeyRound size={12} />}
      width="w-72"
      open={open}
      onOpenChange={setOpen}
    >
      <FormInput
        type="password"
        label="Current password"
        value={current}
        onChange={setCurrent}
      />
      <FormInput
        type="password"
        label="New password"
        value={next}
        onChange={setNext}
      />
      <FormInput
        type="password"
        label="New password again"
        value={again}
        onChange={setAgain}
        onEnter={() => void submit()}
      />
      <FormError>{error}</FormError>
      <TgButton size="sm" loading={busy} onClick={() => void submit()}>
        Change
      </TgButton>
    </FormPill>
  )
}

export function Password() {
  return (
    <PasswordForm
      onChange={async (current, next) => {
        await usersUpdatePasswordMe({
          body: { current_password: current, new_password: next },
        })
        toast.success("Password updated successfully")
      }}
    />
  )
}

const STATUS_TONE = { normal: "ok", degraded: "warn", blocked: "bad" } as const

export function UsageTable({
  budgets,
  isPending,
}: {
  budgets: MyBudgetUsage[]
  isPending: boolean
}) {
  return (
    <ListTable
      testId="my-usage"
      columns={[
        { label: "Budget" },
        { label: "Used today", className: "text-right" },
        { label: "Allowance", className: "text-right" },
        { label: "Ceiling", className: "text-right" },
        { label: "Status" },
      ]}
      isEmpty={!budgets.length}
      empty={isPending ? "Loading…" : "No usage yet"}
    >
      {budgets.map((b) => {
        const row = budgetRow(b)
        const tone = STATUS_TONE[b.status as keyof typeof STATUS_TONE] ?? "off"
        return (
          <tr key={b.budget} className={rowClass}>
            <td className={`${cellClass} font-semibold`}>{row.label}</td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {row.spent}
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {row.allowance}
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {row.ceiling}
            </td>
            <td className={cellClass}>
              <Status tone={tone}>{row.status}</Status>
            </td>
          </tr>
        )
      })}
    </ListTable>
  )
}

export function Usage() {
  const { data, isPending } = useMyQuota()
  return <UsageTable budgets={data?.budgets ?? []} isPending={isPending} />
}

export function DeleteAccountView({
  canDelete,
  onDelete,
}: {
  canDelete: boolean
  onDelete: () => Promise<unknown>
}) {
  if (!canDelete)
    return (
      <p className="text-xs text-app-ink/60">
        An Admin cannot delete its own account; another Admin can.
      </p>
    )
  return (
    <ConfirmButton
      label="Delete my account"
      title="Delete your account?"
      description="Your follows, Summaries, Chats, Tag runs, keys, bots and personal Settings go with it. This cannot be undone."
      confirmLabel="Delete account"
      onConfirm={onDelete}
      trigger={(open) => (
        <TgButton size="sm" variant="dangerSoft" onClick={open}>
          <Trash2 size={12} /> Delete my account
        </TgButton>
      )}
    />
  )
}

export function DeleteAccount() {
  const { user, logout } = useAuth()
  return (
    <DeleteAccountView
      // The server refuses a superuser deleting itself; this only says so
      // before the click rather than after.
      canDelete={!user?.is_superuser}
      onDelete={async () => {
        await usersDeleteUserMe()
        toast.success("Your account has been successfully deleted")
        logout()
      }}
    />
  )
}
